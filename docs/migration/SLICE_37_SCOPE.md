# SLICE_37_SCOPE.md — Audit price-preview
> Basé sur `routes/booking_routes.py:115–158`, `docs/migration/SLICE_30_*.md`.
> Généré le 2026-04-26.

---

## ⚠️ Constat : `POST /bookings/price-preview` est DÉJÀ couvert par Slice 30

L'audit confirme que cet endpoint est intégralement documenté/migré via S30.

### Vérification ligne-à-ligne

| Élément | Slice 30 | Code Python actuel | Divergence |
|---|---|---|---|
| Endpoint `POST /api/bookings/price-preview` | doc lignes 115–158 | lignes 115–158 | **AUCUNE** |
| Auth `require_auth` | documenté (BR S30) | ligne 123 | **AUCUNE** |
| Body `{service_id}` validation | documenté | lignes 125–127 | **AUCUNE** |
| SELECT services WHERE active=TRUE | documenté (S30 DB_MAPPING) | lignes 130–135 | **AUCUNE** |
| Appel `pricing_engine.compute_pricing` | documenté | lignes 138–145 | **AUCUNE** |
| Response 9 champs (`base_amount`, `payer_*`, `receiver_*`, `platform_total_fee`, `currency`) | documenté (S30_API_CONTRACTS) | lignes 148–158 | **AUCUNE** |
| 400 si `service_id` manquant, 404 si service inactif | documenté | lignes 127, 135 | **AUCUNE** |

### Documents S30 couvrant price-preview

- `SLICE_30_SCOPE.md` : ligne 11 (Endpoint #1), ligne 46 (fichier référence), ligne 103 (résumé)
- `SLICE_30_API_CONTRACTS.md` : section "Endpoint 1 — `POST /api/bookings/price-preview`"
- `SLICE_30_BUSINESS_RULES.md` : auth STRICTE
- `SLICE_30_DB_MAPPING.md` : ligne 361 (transactionnalité readOnly)
- `SLICE_30_TEST_CASES.md` : cas `PRV-01` à `PRV-XX`
- `SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md` : ligne 59 (`@PostMapping("/price-preview")`)

---

## Statut actuel

**Endpoint** : `POST /api/bookings/price-preview`

| Critère | Statut |
|---|---|
| Couvert par doc migration | ✅ S30 (datée 2026-XX-XX) |
| Code Python a-t-il évolué depuis S30 ? | ❌ Non (vérifié — identique aux lignes 115–158) |
| Cas de régression à valider | ⚠️ uniquement si Cursor a livré le code Java (sinon : suivre S30 strict) |
| Decision recommandée | **NE RIEN FAIRE** — ne pas refaire, ne pas redocumenter |

---

## Décision recommandée — PASSER À LA VRAIE PROCHAINE SLICE

S37 ne fait **aucun travail nouveau** sur price-preview (compat Python identique à S30). Il documente uniquement l'audit + redirige l'effort vers la vraie prochaine slice utile au front.

### Vraies slices manquantes (ordre de priorité front)

| Priorité | Slice | Endpoint Python | Lignes | Pourquoi |
|---|---|---|---|---|
| 🔴 **P0** | **S38 — Booking Cancel** | `POST /bookings/{id}/cancel` (alias `DELETE`) | 754–983 | Action courante buyer + déclenche refund webhook S35 (déjà migré). Permet au buyer d'annuler sans assistance support. |
| 🔴 **P0** | **S39 — Booking Refuse** | `POST /bookings/{id}/refuse` | 675–753 | Action coach simple. Pas de Stripe (pas encore de payment intent). Petit. |
| 🟡 **P1** | **S40 — Booking Accept** | `POST /bookings/{id}/accept` | 401–557 | Action coach pour `manual_approval` workflow. Crée Stripe payment intent. Plus complexe. |
| 🟡 **P1** | **S41 — Subscriptions webhook** | `_handle_subscription_event` | 586–977 | Gros (~400 lignes). Ferme le webhook Stripe complet. |
| 🟢 **P2** | **S42 — Admin PATCH status** | `PATCH /bookings/{id}/status` | 984–1034 | Admin override. Très peu utilisé. |
| 🟢 **P2** | **S43 — Chat/WebSocket** | `chat_routes.py` | 700+ lignes | Gros chantier dédié. |

> **Recommandation forte** : commencer par **S38 (cancel)** car :
> 1. Action courante du buyer côté UI (bouton "Annuler ma réservation")
> 2. Le refund flow est déjà migré (S35) → le cancel **déclenche** le refund Stripe → S35 reçoit le webhook → tout marche end-to-end
> 3. Permet au buyer de gérer ses réservations en autonomie côté Java
> 4. Renforce le parcours buyer (créer S30 → consulter S11/S34 → annuler S38 → refund S35) en boucle complète

---

## Fichiers Python relus pour cet audit

| Fichier | Lignes | Différence vs S30 |
|---|---|---|
| `routes/booking_routes.py` | 115–158 (price-preview) | **Identique** |
| `pricing_engine.py` | (référencé S30) | **Non re-vérifié dans S37** |

---

## Niveau de risque S37

**ZÉRO.** S37 ne porte aucun nouveau code, ne modifie aucun document existant, ne re-spécifie rien. C'est un audit pur avec orientation roadmap.

---

## Résumé ultra court

- **price-preview déjà couvert ou non** : ✅ **OUI, intégralement par Slice 30**. Code Python (lignes 115–158) identique à la spec S30. Aucune divergence détectée.

- **Écarts éventuels** : **AUCUN**. Si Cursor a livré S30 côté Java, l'endpoint est en prod conforme. Si Cursor n'a pas encore livré S30, il doit suivre `SLICE_30_*.md` strict — pas besoin de S37 pour ça.

- **Action recommandée** : **NE RIEN FAIRE sur price-preview**. Skip S37 en tant que nouveau port. Re-router l'effort sur la vraie prochaine slice manquante.

- **Prochaine vraie slice** : 🔴 **S38 — `POST /bookings/{id}/cancel`** (lignes 754–983 de `booking_routes.py`). Justifications :
  1. **Plus utile au front** : action courante du buyer (bouton "Annuler ma réservation").
  2. **Boucle parcours complète** : création S30 → consultation S11/S34 → cancel S38 → refund webhook S35 (déjà migré).
  3. **Ferme l'autonomie buyer** côté Java sans dépendance support client.
  4. **Bénéficie d'infra déjà en place** : S35 (refund handler) reçoit automatiquement le webhook Stripe déclenché par le cancel → pas de nouvelle plomberie webhook nécessaire.
  5. **Risque maîtrisé** : transitions DB connues (`bookings.status='cancelled'`, `cancelled_by_user_id`, `cancellation_reason`), Stripe refund SDK simple, notifications réutilisent infra S33-S35.
