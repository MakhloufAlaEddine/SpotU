# SLICE_35_API_CONTRACTS.md — Contrats API Webhook Charge/Refund Handlers
> Basé sur `webhook_handlers.py:458–582, 1013–1015`.
> Généré le 2026-04-25.

---

## Endpoint réutilisé — `POST /api/webhook/stripe` (S32)

S35 **n'expose pas** de nouvel endpoint. Le contrat HTTP du wrapper est défini dans `SLICE_32_API_CONTRACTS.md`.

S35 documente :
- Les **payloads Stripe** des 2 events
- Les **transitions DB** déclenchées
- Les **notifications** émises (1 seule, sur `charge.refunded`)
- Les **effets de bord**

---

## Event 1 — `charge.refunded`

### Payload Stripe (extrait pertinent)

```json
{
  "id": "evt_001",
  "type": "charge.refunded",
  "data": {
    "object": {
      "id": "ch_xxx",                  // charge_id
      "object": "charge",
      "amount": 5175,                  // total charge en centimes
      "amount_refunded": 5175,         // refund cumulé en centimes
      "refunded": true,                // boolean : full ou partial
      "payment_intent": "pi_xxx",
      "metadata": {
        "payment_id": "pay_abc",       // si présent (set par S30)
        "booking_id": "bkg_xyz"
      }
    }
  }
}
```

### Pipeline backend exact

```
1. _resolve_payment_id (S33) :
   - metadata.payment_id si présent → court-circuit
   - sinon : pas de PI lookup (event=charge.refunded → obj.payment_intent)
   - sinon : strat. 4 charge_id (obj.id startsWith "ch_")

2. SI payment_id introuvable :
   Tentative supplémentaire interne au handler :
     SELECT payment_id FROM payments WHERE stripe_charge_id = obj.id LIMIT 1
   SI toujours None → log DEBUG + early return

3. Extraction :
   amount_refunded_cents = obj.amount_refunded (default 0)
   amount_refunded       = round(amount_refunded_cents / 100, 2)
   fully_refunded        = bool(obj.refunded)
   charge_id             = obj.id

4. new_status    = "refunded" si fully_refunded sinon "partially_refunded"
   refund_status = "succeeded"

5. UPDATE payments
       SET status=$1, refund_amount=$2, refund_status=$3,
           stripe_charge_id=COALESCE(stripe_charge_id, $4),
           updated_at=NOW()
       WHERE payment_id=$5
         AND status NOT IN ('refunded')

6. log INFO "Remboursement : payment=... | amount=...€ | full=... → status=..."

7. SI rows_updated > 0 :
   SELECT payer_user_id FROM payments WHERE payment_id=$1
   SI fully_refunded :
     title = "Remboursement effectué"
     body  = f"Vous avez été remboursé de {amount_refunded:.2f} €."
   SINON :
     title = "Remboursement partiel"
     body  = f"Un remboursement partiel de {amount_refunded:.2f} € a été initié."
   pending_notifs.append({user_id=payer, type='payment_refunded', title, body, data={...}})
```

### Effets DB

| Action | SQL |
|---|---|
| UPDATE payments | voir étape 5 ci-dessus |
| Lookup payer_user_id | `SELECT payer_user_id FROM payments WHERE payment_id=$1` |
| INSERT notification (dispatcher S32) | `notifications` table via `store_notification` |

### Notification (1 seule, payer uniquement)

| Champ | Valeur (full refund) | Valeur (partial) |
|---|---|---|
| `type` | `"payment_refunded"` | `"payment_refunded"` |
| `title` | `"Remboursement effectué"` | `"Remboursement partiel"` |
| `body` | `"Vous avez été remboursé de {amount:.2f} €."` | `"Un remboursement partiel de {amount:.2f} € a été initié."` |
| `data.type` | `"payment_refunded"` | idem |
| `data.payment_id` | `"pay_abc"` | idem |
| `data.refund_amount` | float | float |
| `data.fully_refunded` | `true` | `false` |

> ⚠️ **Aucune notif au receiver** (asymétrie volontaire avec S33 booking_confirmed).

---

## Event 2 — `refund.updated`

### Payload Stripe

```json
{
  "id": "evt_002",
  "type": "refund.updated",
  "data": {
    "object": {
      "id": "re_xxx",                  // refund_id
      "object": "refund",
      "status": "succeeded",           // pending|succeeded|failed|canceled
      "charge": "ch_xxx",              // charge_id parent
      "amount": 5175,                  // montant refund en centimes
      "payment_intent": "pi_xxx",
      "metadata": {}
    }
  }
}
```

### Pipeline backend exact (2 phases)

**Phase 1 — Resolution + edge case full-refund** :
```
SI payment_id introuvable (resolver retourne None) ET charge_id présent :
  SELECT payment_id, payer_total_amount FROM payments WHERE stripe_charge_id=$1 LIMIT 1
  SI trouvé :
    payment_id = row.payment_id
    total      = float(row.payer_total_amount or 0)
    SI refund_status == "succeeded" ET abs(amount - total) < 0.02 :
      UPDATE payments
          SET refund_status='succeeded', refund_amount=$amount,
              status='refunded', updated_at=NOW()
          WHERE payment_id=$id AND status != 'refunded'
      log INFO "refund.updated → remboursement complet confirmé : refund=... | payment=..."
      RETURN  ← early return, pas d'UPDATE Phase 2, pas de notif
```

**Phase 2 — Sync `refund_status` simple** :
```
SI payment_id résolu (par resolver OU Phase 1 partielle) :
  UPDATE payments
      SET refund_status=$status, updated_at=NOW()
      WHERE payment_id=$id
  log INFO "refund.updated : refund=... | status=... | payment=..."
SINON :
  log DEBUG "refund.updated : payment introuvable (refund=... charge=...)"
  return
```

### Effets DB

| Cas | Effet |
|---|---|
| Phase 1 succeeded + full | UPDATE `status='refunded'`, `refund_status='succeeded'`, `refund_amount` |
| Phase 2 (cas normal) | UPDATE `refund_status` UNIQUEMENT |
| payment introuvable | aucun effet |

### Notification

**AUCUNE** (Python comment ligne 473 : *"Pas de notification supplémentaire (charge.refunded l'a déjà envoyée)"*).

> ⚠️ Java : ne **PAS** ajouter de notif "par cohérence". Asymétrie volontaire.

---

## Réponse HTTP (toutes branches)

Le wrapper S32 retourne toujours :

| Cas | HTTP | Body |
|---|---|---|
| Event traité (charge.refunded ou refund.updated) | 200 | `{"received": true}` |
| Event doublon (idempotence S32) | 200 | `{"received": true, "idempotent_skip": true}` |
| Handler exception (catché par dispatcher S32) | 200 | `{"received": true}` (DB `stripe_webhook_events.status='error'`) |
| `payment_id` introuvable + early return | 200 | `{"received": true}` (`stripe_webhook_events.status='success'`) |

---

## Effets de bord par event — synthèse

| Event | UPDATE payments | Notifs | Notes |
|---|---|---|---|
| `charge.refunded` (full) | `status='refunded'`, `refund_amount`, `refund_status='succeeded'`, `stripe_charge_id` (COALESCE) | 1 (payer, "Remboursement effectué") | |
| `charge.refunded` (partial) | `status='partially_refunded'`, idem | 1 (payer, "Remboursement partiel") | |
| `charge.refunded` (payment introuvable) | aucune | aucune | log DEBUG |
| `refund.updated` (Phase 1, full edge case) | `status='refunded'`, `refund_status`, `refund_amount` | aucune | early return |
| `refund.updated` (Phase 2, sync) | `refund_status` UNIQUEMENT | aucune | log INFO |
| `refund.updated` (payment introuvable) | aucune | aucune | log DEBUG |

---

## Logging requis (compat stricte)

| Niveau | Message exact |
|---|---|
| INFO | `"Remboursement : payment=%s | amount=%.2f€ | full=%s → status=%s"` (charge.refunded) |
| INFO | `"refund.updated → remboursement complet confirmé : refund=%s | payment=%s"` (Phase 1 edge case) |
| INFO | `"refund.updated : refund=%s | status=%s | payment=%s"` (Phase 2 sync) |
| DEBUG | `"charge.refunded : payment_id introuvable (charge=%s)"` |
| DEBUG | `"refund.updated : payment introuvable (refund=%s charge=%s)"` |

> ⚠️ Les `|` séparateurs et le `€` (Unicode U+20AC) sont reproduits **bit-pour-bit**.

---

## Cas limites

| Cas | Comportement Python | Java doit reproduire |
|---|---|---|
| `charge.refunded` sans `metadata.payment_id` ET `payments.stripe_charge_id` non set | Lookup interne `WHERE stripe_charge_id=obj.id` ; si trouvé → procéder ; si non → log DEBUG + skip | ✅ |
| `amount_refunded` absent | default 0 → refund_amount = 0.00 | ✅ |
| `refunded` absent | `bool(None)` = False → partially_refunded | ✅ test edge |
| `charge_id` absent (rare) | `_get(obj, "id")` → None → COALESCE garde l'existant | ✅ |
| `refund.updated.amount` est null/absent | default 0 → comparaison Phase 1 échoue (0 ≠ total) → tombe en Phase 2 | ✅ |
| `refund.updated.charge` est null | Phase 1 entièrement skip | ✅ |
| `payer_total_amount` est null | `float(None or 0) = 0.0` → comparaison Phase 1 échoue (sauf si amount=0 aussi) | ✅ |
| `refund.status` valeurs autres que succeeded | Phase 1 skip → Phase 2 UPDATE `refund_status='pending'` ou `'failed'` ou `'canceled'` | ✅ |
| `charge.refunded` event reçu après que `refund.updated` ait déjà set `refunded` | Guard `WHERE status NOT IN ('refunded')` bloque → rows=0 → pas de notif | ✅ |
| `charge.refunded` reçu 2× (Stripe retry) | S32 idempotence event-level bloque → idempotent_skip | ✅ |

---

## Valeurs de status `refund_status` attendues

| Valeur | Source | Notes |
|---|---|---|
| `'pending'` | `refund.updated.status` | Refund en cours côté Stripe |
| `'succeeded'` | `charge.refunded` (always) + `refund.updated` | Refund effectif |
| `'failed'` | `refund.updated.status` | Refund rejeté |
| `'canceled'` | `refund.updated.status` | Refund annulé avant exécution |

> ⚠️ Pas de validation enum applicative — le code Python passe la valeur Stripe telle quelle. Reproduire le comportement (pas de check whitelist).

---

## Valeurs de status `payments.status` après refund

| Avant | Après (charge.refunded full) | Après (charge.refunded partial) | Après (refund.updated edge case) |
|---|---|---|---|
| `captured` | `refunded` | `partially_refunded` | `refunded` |
| `partially_refunded` | `refunded` | `partially_refunded` (idempotent rows=0 si même montant) | `refunded` |
| `refunded` | `refunded` (rows=0, guard) | `refunded` (rows=0, guard) | `refunded` (rows=0, `WHERE status != 'refunded'`) |
| `authorized` / `pending` / `failed` | rows=0 (guard ne bloque que `refunded`) | NON — guard autorise toute valeur sauf `refunded` → transition vers `refunded` est possible mais bizarre | edge |

> ⚠️ Note importante : la guard est `WHERE status NOT IN ('refunded')`. Cela autorise même `pending → refunded` (ne devrait pas arriver en pratique mais le code l'accepte). **Ne pas restreindre** côté Java sauf demande explicite.
