# SLICE_37_TEST_CASES.md — Audit price-preview tests (no-op + régressions)
> Basé sur `routes/booking_routes.py:115–158`, `SLICE_30_TEST_CASES.md` (cas `PRV-XX`).
> Généré le 2026-04-26.

---

## ⚠️ Document de référence : `SLICE_30_TEST_CASES.md` — section `PRV-XX` (price-preview)

S37 n'invente **aucun nouveau cas de test**. Il liste uniquement les régressions à exécuter post-S33/S35 si Cursor a déjà livré S30.

---

## Cas nominaux — déjà documentés en S30

Voir `SLICE_30_TEST_CASES.md` :
- `PRV-01` : nominal — service actif, response 9 champs
- `PRV-02` : 400 si `service_id` absent
- `PRV-03` : 404 si service inactif
- `PRV-04` : 404 si service inexistant
- `PRV-05` : 401 si auth invalide
- `PRV-06` : impact subscription (avantage tarif si payer abonné)
- `PRV-07` : format Decimal → number JSON

> ⚠️ **Ne pas dupliquer** ces cas dans S37. Les exécuter **tels quels** depuis S30.

---

## Cas de régression à ajouter (uniquement si Cursor a livré S30)

### T37-R1 — Régression S33 : changement subscription du payer impacte le tarif

**Setup** :
1. Payer a une subscription active → tarif réduit
2. Webhook S33 ne touche pas subscription, pas d'impact direct

**Action** : `POST /bookings/price-preview` avec service.

**Résultat** : tarif **identique** avant/après webhook S33 (pas d'interaction).

> Test à inclure uniquement si une boucle S33 ↔ price-preview est suspectée. Sinon **skip**.

### T37-R2 — Régression S34 : `pricing_rule_snapshot` non impacté par les reads

**Setup** : Payer consulte `/payments/me` puis fait price-preview.

**Action** : `POST /bookings/price-preview`.

**Résultat** : tarif déterministe selon `services.price` + subscriptions du payer. Pas d'effet de bord de S34.

### T37-R3 — Régression S35 : refund n'impacte pas le price-preview

**Setup** : Payer a un payment refundé via S35.

**Action** : Ce même payer fait `POST /bookings/price-preview` sur un nouveau service.

**Résultat** : Tarif calculé normalement. Le statut `refunded` d'un autre payment n'interfère pas.

### T37-R4 — Compat config Jackson S34 (datetime, BigDecimal)

**Action** : `POST /bookings/price-preview`.

**Assertions** :
- Tous les montants sont des **numbers** JSON (pas strings)
- `currency` = `"EUR"` (string)
- Pas de champ datetime à vérifier (price-preview n'en retourne pas)

> Réutilise la config Jackson de S34 (`PaymentJacksonConfig`).

---

## Cas à NE PAS dupliquer

| Cas S30 | Pourquoi ne pas le refaire en S37 |
|---|---|
| `PRV-01` à `PRV-07` | Déjà couverts intégralement en S30 |
| Cas nominal général | Idem |
| Cas auth Bearer/cookie | Couvert par S30 + factorisation S34 (BR-34.01) |
| Cas subscription impact | Couvert par S30 + slices pricing |

---

## Cas potentiellement manquants

Aucun identifié. Le test plan S30 est complet pour cet endpoint.

---

## Notes runner Java

- **Réutiliser le harness S34** : Testcontainers, MockMvc, JSONAssert STRICT, JWT helpers
- **Seeders** : `services` actif/inactif + `subscriptions` (pour PRV-06)
- **Asserter format response** :
  ```java
  String body = response.getContentAsString();
  JsonNode json = objectMapper.readTree(body);
  assertThat(json.get("base_amount").isNumber()).isTrue();      // pas string
  assertThat(json.get("currency").asText()).isEqualTo("EUR");
  assertThat(json.size()).isEqualTo(9);                          // exactement 9 champs
  ```

---

## Conclusion

S37 = **AUCUN nouveau cas de test à écrire**. S30 couvre intégralement price-preview. Si vous avez besoin de valider l'endpoint Java, exécutez les cas `PRV-XX` documentés en S30.

**Re-router l'effort vers S38 (booking cancel)** qui aura besoin de **dizaines de nouveaux cas** spécifiques (transitions DB, refund déclenché, notifications push, idempotence).
