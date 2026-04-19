# SLICE_27_BUSINESS_RULES.md — Règles métier
> Généré le 2026-04-15.

---

## BR-01 — Owner ne peut pas joindre son propre SpotYou
```
RÈGLE : POST /join → 400 si user_id == owner_id.
SOURCE : tagpoint_routes.py:710–711.
```

## BR-02 — Private = invitation uniquement
```
RÈGLE : Si visibility_type='private' → POST /join retourne 403.
        L'accès se fait UNIQUEMENT via invite + accept.
SOURCE : tagpoint_routes.py:735–739.
```

## BR-03 — 3 modes de join sur SpotYou public
```
RÈGLE : open → accepted direct | admin_approval → pending + notif owner | members_approval → pending + notif tous membres.
SOURCE : tagpoint_routes.py:750–797.
```

## BR-04 — Idempotence join (statuts existants)
```
RÈGLE : Si l'user a déjà un membership :
        accepted → retour silencieux {status: "accepted"} (pas d'erreur)
        pending → retour {status: "pending"} (pas de re-submit)
        invited → retour {status: "invited"} (message: acceptez l'invitation)
        rejected → ON CONFLICT DO UPDATE → re-soumission autorisée
SOURCE : tagpoint_routes.py:718–729, 755–760.
```

## BR-05 — Re-join après reject via ON CONFLICT DO UPDATE
```
RÈGLE : Un user rejected peut se re-joindre. Le SQL utilise
        ON CONFLICT (spot_you_id, user_id) DO UPDATE SET status='pending' WHERE status='rejected'.
        Cela signifie que si le status est AUTRE que 'rejected', le DO UPDATE ne s'applique PAS
        et l'INSERT échoue silencieusement (ON CONFLICT).
SOURCE : tagpoint_routes.py:755–761.
EN JAVA : Requête native @Query. JPA standard ne supporte pas ON CONFLICT DO UPDATE WHERE.
PIÈGE : Le WHERE sur la clause UPDATE (pas la clause WHERE principale).
```

## BR-06 — Capacité max_community_members
```
RÈGLE : Si max_community_members est défini (non-null) et que le nombre de membres accepted >= max → 409.
        Pas de lock (race condition possible mais acceptable pour MVP).
SOURCE : tagpoint_routes.py:742–748.
```

## BR-07 — cancel-request : pending UNIQUEMENT
```
RÈGLE : Seule une demande pending peut être annulée. accepted → 400, rejected → 400, absent → 404.
        Annulation = DELETE physique (pas soft-delete).
SOURCE : tagpoint_routes.py:847–854.
```

## BR-08 — leave : fonctionne même sur SpotYou inactif
```
RÈGLE : DELETE /leave n'exige PAS active=TRUE. Un user peut quitter un SpotYou désactivé.
        Leave = DELETE physique (pas UPDATE status='left').
SOURCE : tagpoint_routes.py:1271–1273.
```

## BR-09 — invite : permissions admin_only vs admin_and_members
```
RÈGLE : admin_only → seul l'owner peut inviter (403 pour les membres).
        admin_and_members → owner OU membre accepted peut inviter.
        Le caller est vérifié via SELECT EXISTS spot_you_members.
SOURCE : tagpoint_routes.py:898–908.
```

## BR-10 — invite : anti-doublon par status
```
RÈGLE : accepted → 409, pending → 409, invited → 409, rejected → UPDATE réinvitation, ∅ → INSERT.
        Un user rejected peut être RÉINVITÉ (pas re-join).
SOURCE : tagpoint_routes.py:920–942.
```

## BR-11 — accept/refuse invitation : status='invited' uniquement
```
RÈGLE : Les 2 endpoints vérifient status='invited'. Toute autre valeur → 409 avec le statut actuel.
SOURCE : tagpoint_routes.py:1024–1025, 1076–1077.
```

## BR-12 — approve : admin_approval → owner seul, members_approval → owner + membres
```
RÈGLE : Même logique de permission que /join-requests (BR-09 bis).
        1 seule acceptation suffit (MVP).
SOURCE : tagpoint_routes.py:1172–1175.
```

## BR-13 — reject : owner seul (+ platform admin)
```
RÈGLE : Seul le propriétaire du SpotYou (ou un admin plateforme) peut REJETER.
        Les membres ne peuvent PAS rejeter (asymétrie avec approve).
SOURCE : tagpoint_routes.py:1229–1230.
ASYMÉTRIE : approve → owner + membres (si members_approval). reject → owner seul.
```

## BR-14 — Push notifications fire-and-forget
```
RÈGLE : Toutes les notifications sont envoyées via asyncio.create_task(send_push_to_user(...)).
        Elles ne bloquent PAS la réponse HTTP et les erreurs sont silencieuses.
SOURCE : tagpoint_routes.py:776,791,818,947,1041,1090,1201,1254,1286.
EN JAVA : @Async void sendNotification(...) ou CompletableFuture.runAsync().
```

## BR-15 — Notification data contient sender_info
```
RÈGLE : Les push data incluent systématiquement : type, point_id, sender_id, sender_name,
        sender_picture, action_text, content_title, image_url.
        Le front utilise ces champs pour afficher la notification.
SOURCE : tagpoint_routes.py:765–771 (join_request data pattern).
```
