# SLICE_37_CURSOR_IMPLEMENTATION_NOTES.md — Audit price-preview (no-op)
> Basé sur `routes/booking_routes.py:115–158`, `SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md` § "Endpoint 1 — Price Preview".
> Généré le 2026-04-26.

---

## ⚠️ Document de référence : `SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md`

Le squelette Spring Boot complet de `POST /api/bookings/price-preview` est documenté en S30 (à partir de la ligne 59 du doc — `@PostMapping("/price-preview")`).

S37 = **audit no-op**. Aucun nouveau code, aucun patch.

---

## Décision arborescente — que faire ?

```
Question : Cursor a-t-il déjà livré le code Java de S30 ?
│
├─ NON → Suivre SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md strict.
│         Ne pas utiliser S37 (qui n'apporte rien de neuf).
│
└─ OUI → 1. Exécuter cas PRV-01 à PRV-XX (SLICE_30_TEST_CASES.md)
         2. Si tous passent → AUCUNE ACTION sur price-preview.
                              Passer à S38 (booking cancel).
         3. Si régression détectée → fix selon delta observé.
                                      Aucun pattern S37 à appliquer.
```

---

## Si délai détecté (peu probable)

Aucun delta entre S30 et le code Python actuel n'a été identifié à la date du 2026-04-26. Si Cursor remonte un delta lors d'une exécution future :

1. **Re-vérifier** `routes/booking_routes.py:115–158` côté Python (le code peut avoir évolué)
2. Si Python a changé → créer une **nouvelle** slice (S37b ou S37.1) documentant le delta
3. Si Python n'a pas changé mais Java diverge → **bug Java** à fixer en suivant S30

---

## Critères de Done S37

| # | Critère | Action |
|---|---|---|
| 1 | Audit confirmé : price-preview Python identique à spec S30 | ✅ Fait (vérifié 2026-04-26) |
| 2 | Aucun nouveau code Java écrit | ✅ |
| 3 | Aucun document S30 modifié | ✅ |
| 4 | Recommandation prochaine slice formulée | ✅ S38 (booking cancel) |
| 5 | Roadmap mise à jour dans PRD.md | ✅ (entrée S37 audit only) |

---

## Recommandation prochaine slice — S38 Booking Cancel

### Pourquoi S38 plutôt qu'autre chose

| Critère | S38 (cancel) | S39 (refuse) | S40 (accept) | S41 (subscriptions) |
|---|---|---|---|---|
| Utilité front directe | 🟢 ÉLEVÉE (action buyer) | 🟢 MOYENNE (action coach) | 🟡 MOYENNE | 🔴 FAIBLE |
| Taille code Python | 🟡 MOYEN (~230 lignes) | 🟢 PETIT (~80 lignes) | 🟡 MOYEN (~150 lignes) | 🔴 GROS (~400 lignes) |
| Dépendances | S35 (refund webhook ✅), notifications | aucune Stripe | Stripe payment intent | nouvelle infra |
| Risque | MOYEN (refund Stripe) | FAIBLE | ÉLEVÉ (capture asynchrone) | TRÈS ÉLEVÉ (lifecycle) |
| Boucle parcours buyer | ✅ ferme cancel→refund | partial | partial | hors parcours buyer |

### S38 — Préparation rapide

**Fichier Python** : `routes/booking_routes.py:754–983` (`POST /bookings/{id}/cancel` + alias `DELETE`).

**Périmètre attendu (à confirmer en S38)** :
- Cancel par payer ou receiver (permissions à définir)
- Transition `bookings.status` selon état actuel (requested → cancelled, awaiting_payment → cancelled, confirmed → cancelled + refund)
- Stripe refund SDK appelé si payment captured → webhook `charge.refunded` reçu plus tard (S35 traite)
- Notifications push aux 2 parties
- Idempotence

**Pré-requis (déjà migrés)** :
- ✅ S30 (booking pay) → payment existe
- ✅ S33 (webhook payment) → `bookings.status='confirmed'` peut être transitionné
- ✅ S35 (refund webhook) → reçoit le `charge.refunded` déclenché par le cancel
- ✅ S11 (booking reads) → buyer voit le booking

**Pré-requis manquants** :
- Pattern `notification` push réel (Expo) — peut être stub initialement (`store_notification` suffit)

---

## Si user choisit S39 (refuse) à la place

Justifications alternatives valables :
- Plus petit (~80 lignes)
- Pas de Stripe (refuse arrive avant payment intent)
- Action coach simple

Mais : **moins de valeur immédiate côté buyer** (le buyer ne peut toujours pas annuler ses bookings côté Java).

---

## Conclusion S37

> **price-preview est déjà couvert par Slice 30 — aucune action requise.**
>
> **Slice 37 = audit no-op + redirection vers Slice 38 (booking cancel)**.
>
> Si Cursor a livré S30, l'endpoint price-preview est en prod conforme. Sinon, suivre S30 strict. Dans les deux cas, **passer à S38 immédiatement** pour continuer la migration backend.
