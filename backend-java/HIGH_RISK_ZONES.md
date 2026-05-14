# HIGH_RISK_ZONES

Date: 2026-05-08  
Objectif: top risques prod concrets avant cutover.

## Top 10 risques

1. **Webhook Stripe sans secret**
- Si `STRIPE_WEBHOOK_SECRET` vide, verification signature desactivee.
- Risque: injection d'evenements frauduleux.

2. **Serving uploads local non expose**
- URLs fallback `/api/uploads/...` potentiellement non resolues.
- Risque: medias casses en prod.

3. **Push transport incomplet**
- Services push no-op sur certains flux.
- Risque: perte de notifications utilisateur.

4. **WS multi-instance non distribue**
- Registry process-local seulement.
- Risque: diffusions incompletes selon pod.

5. **Purge physique media marketplace stub**
- Marquage DB fait, suppression objet reelle non faite.
- Risque: dette stockage/retention.

6. **Ecarts format erreur cross-domain**
- `detail` vs `error` vs `details[]`.
- Risque: regressions front si parser strict.

7. **Ecarts statut HTTP sur erreurs DB/validation**
- 503/400 a la place de 500/422 Python selon cas.
- Risque: comportements front/monitoring divergents.

8. **Dependance forte PostGIS**
- Fonctionnalites geospatiales critiques.
- Risque: degradations si extension/schema mal provisionnes.

9. **Security policy permissive par defaut**
- `permitAll` global + enforcement applicatif.
- Risque: oubli futur d'un guard dans un nouvel endpoint.

10. **Split-routing global peu teste end-to-end**
- Bonne couverture domaine, mais peu de tests gateway/canary/rollback.
- Risque: incident de bascule plutot qu'incident metier.

## Mitigations prioritaires (avant bascule large)

- P0: forcer `STRIPE_WEBHOOK_SECRET`, regler uploads, clarifier push.
- P1: definir plan WS multi-instance (sticky ou pub/sub).
- P1: contrat erreurs front-safe (tolerance 500/503, 400/422).
- P1: hardening securite (revue endpoints critiques + tests guard).
- P2: terminer purge physique media.

## Niveau de risque global

- **Risque operationnel global: moyen+**
- Justification: metier/API solide et teste, mais infra temps reel/storage partiellement incomplete.
