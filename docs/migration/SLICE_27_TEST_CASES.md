# SLICE_27_TEST_CASES.md — Cas de tests
> Généré le 2026-04-15.

---

## A. Save / Unsave
| TC | Scénario | Résultat |
|---|---|---|
| TC-SV-01 | Save nominal (SpotYou actif) | 200 {is_saved: true} |
| TC-SV-02 | Save SpotYou inactif → 404 | 404 |
| TC-SV-03 | Save doublon (idempotent) | 200 (ON CONFLICT DO NOTHING) |
| TC-SV-04 | Unsave nominal | 200 {is_saved: false} |
| TC-SV-05 | Unsave non sauvegardé → success | 200 (DELETE 0, pas d'erreur) |

## B. Join (3 modes)
| TC | Scénario | Résultat |
|---|---|---|
| TC-JN-01 | Join public+open → accepted direct | 200 {status: "accepted", is_participant: true, participants_count} |
| TC-JN-02 | Join public+admin_approval → pending | 200 {status: "pending"} + push owner |
| TC-JN-03 | Join public+members_approval → pending | 200 {status: "pending"} + push TOUS membres |
| TC-JN-04 | Join private → 403 | 403 "invitation uniquement" |
| TC-JN-05 | Owner join son propre SpotYou → 400 | 400 "déjà créateur" |
| TC-JN-06 | Déjà accepted → retour idempotent | 200 {status: "accepted"} (pas d'erreur) |
| TC-JN-07 | Déjà pending → retour idempotent | 200 {status: "pending"} |
| TC-JN-08 | Déjà invited → message invitation | 200 {status: "invited"} |
| TC-JN-09 | Précédemment rejected → re-join | 200 (ON CONFLICT DO UPDATE status='pending'/'accepted') |
| TC-JN-10 | Capacité max atteinte → 409 | 409 "capacité maximale" |
| TC-JN-11 | SpotYou inexistant/inactif → 404 | 404 |
| TC-JN-12 | Auth absente → 401 | 401 |

## C. Cancel request
| TC | Scénario | Résultat |
|---|---|---|
| TC-CR-01 | Cancel pending → supprimé | 200 "Demande annulée" |
| TC-CR-02 | Cancel accepted → 400 | 400 "déjà traitée" |
| TC-CR-03 | Aucune demande → 404 | 404 |

## D. Leave
| TC | Scénario | Résultat |
|---|---|---|
| TC-LV-01 | Leave nominal | 200 {is_participant: false, participants_count} + push owner |
| TC-LV-02 | Leave SpotYou inactif → OK | 200 (leave permis même si inactif) |
| TC-LV-03 | SpotYou inexistant → 404 | 404 |

## E. Invite
| TC | Scénario | Résultat |
|---|---|---|
| TC-IV-01 | Invite nominal (owner) | 200 + push invité |
| TC-IV-02 | Invite par membre (admin_and_members) | 200 |
| TC-IV-03 | Invite par non-membre (admin_only) → 403 | 403 |
| TC-IV-04 | Invite soi-même → 400 | 400 |
| TC-IV-05 | invited_user_id absent → 400 | 400 |
| TC-IV-06 | User cible inexistant → 404 | 404 |
| TC-IV-07 | Déjà accepted → 409 | 409 "déjà membre" |
| TC-IV-08 | Déjà pending → 409 | 409 "demande en attente" |
| TC-IV-09 | Déjà invited → 409 | 409 "invitation en attente" |
| TC-IV-10 | Précédemment rejected → réinvitation | 200 (UPDATE → invited) |

## F. My invitations (read)
| TC | Scénario | Résultat |
|---|---|---|
| TC-MI-01 | 2 invitations reçues | 200 + array de 2 avec inviter, invited_at, join_status="invited" |
| TC-MI-02 | Aucune invitation → [] | 200 + [] |

## G. Accept / Refuse invitation
| TC | Scénario | Résultat |
|---|---|---|
| TC-AI-01 | Accept invitation → accepted | 200 {status: "accepted", participants_count} + push inviteur |
| TC-AI-02 | Accept non-invited → 409 | 409 |
| TC-AI-03 | Accept inexistant → 404 | 404 |
| TC-RI-01 | Refuse invitation → rejected | 200 {status: "rejected"} + push inviteur |
| TC-RI-02 | Refuse non-invited → 409 | 409 |

## H. Join requests (read) + Approve / Reject
| TC | Scénario | Résultat |
|---|---|---|
| TC-JR-01 | List pending (owner) | 200 + array {user_id, name, picture, requested_at} |
| TC-JR-02 | List pending (membre, members_approval) | 200 |
| TC-JR-03 | List pending (membre, admin_approval) → 403 | 403 |
| TC-AP-01 | Approve pending → accepted | 200 {participants_count} + push membre |
| TC-AP-02 | Approve déjà accepted → 409 | 409 |
| TC-AP-03 | Approve inexistant → 404 | 404 |
| TC-RJ-01 | Reject pending (owner) → rejected | 200 + push membre |
| TC-RJ-02 | Reject par non-owner → 403 | 403 |
| TC-RJ-03 | Reject déjà accepted → 409 | 409 |
| TC-RJ-04 | Reject UPDATE 0 → 404 | 404 "déjà traitée" |

---

## Résumé

| Catégorie | Nombre |
|---|---|
| Save/Unsave | 5 |
| Join | 12 |
| Cancel | 3 |
| Leave | 3 |
| Invite | 10 |
| My invitations | 2 |
| Accept/Refuse | 5 |
| Requests/Approve/Reject | 8 |
| **TOTAL** | **48** |
