# FINAL_ENGINEERING_VERDICT

Date: 2026-05-08  
Type: verdict contradictoire (contre-validation des conclusions Emergent).

## Verdict final

- **Recommendation: PARTIAL GO (strict)**  
- **Niveau de confiance reel: moyen (6.5/10)**  
- **Readiness estimee honnete: 68-74%** (plus bas que 75-84% Emergent)

## Pourquoi plus bas que Emergent

1. SAFE_TO_SWITCH surestime sur runtime temps reel.
2. Stubs explicites encore presents (push/notif/purge physique).
3. Risques multi-instance WS non adresses nativement.
4. Fragilite securite "permitAll + enforcement applicatif".
5. Gaps front legacy + heterogeneite erreurs sous-estimes.

## Ce qui doit ABSOLUMENT etre fait avant prod large

1. **P0 security/stripe**
- Rendre `STRIPE_WEBHOOK_SECRET` obligatoire en prod.
- Durcir policy security (au moins zones sensibles explicites, pas full permitAll).

2. **P0 media**
- Exposer `/api/uploads/**` ou imposer R2-only sans fallback local.

3. **P0 real-time**
- Decider architecture WS cluster (sticky sessions strictes ou bus distribue).
- Clarifier perimetre push reel vs DB-only; combler no-op critiques.

4. **P1 compat front**
- Stabiliser contrat erreurs (shape + status).
- Mettre aliases legacy au gateway si clients encore dependants.

5. **P1 exploitability**
- Runbook rollback split-routing par bounded context.
- Alerting/observabilite sur webhooks, workers, ws.

## Position contradictoire concise

- Emergent a bien evalue le **coeur metier HTTP**.
- Emergent sous-estime les **risques runtime distribues** (temps reel/media/ops).
- Le go-live global immediat serait premature; un **partial go contraint** est acceptable.
