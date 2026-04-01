# Système de migrations — SpotU

Guide complet pour gérer les évolutions de la base de données.

---

## Principes fondamentaux

| Règle | Description |
|-------|-------------|
| **Une migration = un fichier SQL** | Jamais de DDL en dehors de ce dossier |
| **Immuable une fois appliquée** | Ne jamais modifier un `.sql` déjà exécuté |
| **Exécutée une seule fois** | Contrôle par `UNIQUE(name)` + checksum dans `_migrations` |
| **Atomique** | Chaque migration s'exécute dans une transaction — rollback si échec |
| **Ordonnée** | Exécution alphanumérique stricte : `001`, `002`, `003`, … |

---

## Convention de nommage

```
NNN_description_en_snake_case.sql
```

- `NNN` : numéro séquentiel sur 3 chiffres (`001`, `002`, ..., `099`, `100`)
- `description` : verbe + sujet en snake_case, en anglais de préférence
- Max 50 caractères pour le nom total

**Exemples valides :**
```
004_add_user_settings.sql
005_add_index_products_status.sql
006_drop_column_old_price.sql
010_rename_table_locations.sql
```

**Exemples invalides :**
```
migration_finale.sql     ← pas de numéro
04_fix.sql               ← numéro sur 2 chiffres
004_Fix Users Table.sql  ← espaces et majuscules
```

---

## Commandes du quotidien

### Voir l'état des migrations
```bash
cd /app/backend && python migrations/run_migrations.py --status
```

### Appliquer les migrations en attente
```bash
cd /app/backend && python migrations/run_migrations.py
```

### Simuler sans modifier la base (dry-run)
```bash
cd /app/backend && python migrations/run_migrations.py --dry-run
```

### Créer une nouvelle migration
```bash
cd /app/backend && python migrations/run_migrations.py --new add_user_settings
# → Crée : migrations/004_add_user_settings.sql
```

---

## Workflow dev — étape par étape

```
1. Créer la migration
   python migrations/run_migrations.py --new ma_feature

2. Éditer le fichier SQL créé
   vim migrations/004_ma_feature.sql

3. Vérifier en dry-run
   python migrations/run_migrations.py --dry-run

4. Appliquer
   python migrations/run_migrations.py

5. Vérifier
   python migrations/run_migrations.py --status

6. Committer le fichier SQL
   git add migrations/004_ma_feature.sql
   git commit -m "migration: add ma_feature"
```

---

## Structure recommandée d'un fichier de migration

```sql
-- Migration 004 — Ajout des préférences utilisateur
-- Date    : 2026-04-02
-- Auteur  : Jean Dupont
-- Ticket  : https://linear.app/spotu/issue/SP-42
--
-- Description :
--   Ajoute une colonne JSONB `settings` à la table `users`
--   pour stocker les préférences de notification par utilisateur.
--
-- Rollback manuel (si nécessaire) :
--   ALTER TABLE users DROP COLUMN IF EXISTS settings;

-- === DÉBUT DE LA MIGRATION ===

ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

COMMENT ON COLUMN users.settings IS 'Préférences utilisateur (notifications, affichage…)';

-- === FIN DE LA MIGRATION ===
```

---

## Que faire en cas d'échec ?

### La migration a échoué (rollback automatique)

Le runner affiche :
```
❌  ERREUR SQL [004_ma_feature.sql]
    Code     : 42701
    Message  : column "foo" of relation "users" already exists
    → Rollback effectué. _migrations NON modifié.
    → Corrigez le fichier SQL et relancez.
```

**Actions :**
1. Corriger le fichier `.sql` (la migration n'a pas été enregistrée)
2. Relancer : `python migrations/run_migrations.py`

### Une migration a été modifiée après application

Le runner affiche :
```
🚨  ALERTE INTÉGRITÉ : 003_drop_legacy_columns.sql
    Checksum stocké  : 73cd5d931fb56bee
    Checksum actuel  : a1b2c3d4...
    Ce fichier a été modifié après son exécution !
    Action requise   : NE PAS relancer ce fichier.
    Solution         : créer une nouvelle migration pour corriger.
```

**Actions :**
1. **Ne pas modifier** le fichier `.sql` existant
2. Créer une nouvelle migration pour corriger : `--new revert_bad_change`
3. Restaurer le fichier original depuis git : `git checkout migrations/003_*.sql`

---

## Checklist avant de committer une migration

- [ ] Le fichier suit la convention de nommage `NNN_description.sql`
- [ ] La migration a été testée en `--dry-run`
- [ ] La migration a été appliquée et vérifiée dans `--status`
- [ ] Le rollback manuel est documenté dans les commentaires
- [ ] Le fichier est dans un commit seul (1 migration = 1 commit idéalement)

---

## Anti-patterns à éviter

| Interdit | Raison |
|----------|--------|
| Modifier un `.sql` déjà appliqué | Corruption de l'état de la base |
| DDL dans le code Python runtime (`database.py`) | Perte de traçabilité, risque de crash au démarrage |
| Rollback / DROP COLUMN dans le même fichier que la modification | Rend la migration non-atomique |
| `DROP TABLE` sans vérifier les dépendances | Perte de données irréversible |
| Plusieurs modifications non liées dans une même migration | Principe de responsabilité unique |

---

## Table `_migrations` (référence)

```sql
CREATE TABLE _migrations (
    id          SERIAL      PRIMARY KEY,
    name        TEXT        NOT NULL UNIQUE,   -- ex: 004_add_user_settings.sql
    checksum    TEXT        NOT NULL,           -- SHA-256 du contenu
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Limites connues du système

1. **Pas de rollback automatique complexe** — PostgreSQL supporte les DDL transactionnels
   (`CREATE TABLE`, `ALTER TABLE`, etc.) mais certaines opérations comme
   `DROP INDEX CONCURRENTLY` ou `VACUUM` ne peuvent pas être dans une transaction.
   Pour ces cas : documenter le rollback manuel dans les commentaires du fichier.

2. **Pas de rollback des migrations déjà appliquées** — le système est "forward-only".
   Pour "défaire" une migration appliquée, créer une nouvelle migration inverse.

3. **Pas de lock distribué** — si deux développeurs lancent les migrations simultanément,
   la contrainte `UNIQUE(name)` dans `_migrations` protège la cohérence,
   mais le second peut voir une erreur. Acceptable pour un usage non-concurrent.
