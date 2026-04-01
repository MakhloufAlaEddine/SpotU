"""
test_mask_address_unit.py
=========================
Tests unitaires purs pour la fonction _mask_address() de service_routes.py.

Règles testées :
  - 'exact'   → adresse retournée telle quelle (aucun masquage)
  - 'exact'   → None ou '' retourné tel quel (cas limite)
  - '100m'    → numéro de rue supprimé (zone approximative)
  - '100m'    → numéro + suffixe bis/ter/quater supprimé
  - '100m'    → adresse sans numéro → retournée telle quelle
  - '100m'    → adresse sans virgule → retournée telle quelle
  - '1000m'   → ville extraite après le code postal (format "CP Ville")
  - '1000m'   → noms de pays ignorés (France, etc.)
  - '1000m'   → partie unique avec code postal → ville extraite
  - '1000m'   → partie unique sans code postal → retournée telle quelle

Contraintes :
  - Aucune DB, aucun HTTP, aucun réseau
  - Tests lisibles et autonomes
  - Importation directe de la fonction depuis service_routes
"""

import sys
import os

# ── Ajout du répertoire backend au chemin d'import ────────────────────────────
# Permet l'import de _mask_address sans lancer le serveur
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes.service_routes import _mask_address


# ══════════════════════════════════════════════════════════════════════════════
# Précision : exact
# ══════════════════════════════════════════════════════════════════════════════

class TestMaskAddressExact:
    """Précision 'exact' → aucun masquage, retour identique."""

    def test_exact_retourne_adresse_complete(self):
        """'exact' retourne l'adresse complète sans modification."""
        addr = "13 Rue de Rivoli, 75001 Paris, France"
        assert _mask_address(addr, "exact") == addr

    def test_exact_adresse_none_retournee_telle_quelle(self):
        """'exact' avec None → None retourné directement."""
        assert _mask_address(None, "exact") is None

    def test_exact_adresse_vide_retournee_telle_quelle(self):
        """'exact' avec chaîne vide → '' retourné directement."""
        assert _mask_address("", "exact") == ""


# ══════════════════════════════════════════════════════════════════════════════
# Précision : None / vide (indépendant de la précision)
# ══════════════════════════════════════════════════════════════════════════════

class TestMaskAddressNullInput:
    """Adresse nulle ou vide → retournée sans modification, quelle que soit la précision."""

    def test_none_avec_100m_retourne_none(self):
        """None avec '100m' → None."""
        assert _mask_address(None, "100m") is None

    def test_none_avec_1000m_retourne_none(self):
        """None avec '1000m' → None."""
        assert _mask_address(None, "1000m") is None

    def test_chaine_vide_avec_100m_retourne_vide(self):
        """Chaîne vide avec '100m' → ''."""
        assert _mask_address("", "100m") == ""

    def test_chaine_vide_avec_1000m_retourne_vide(self):
        """Chaîne vide avec '1000m' → ''."""
        assert _mask_address("", "1000m") == ""


# ══════════════════════════════════════════════════════════════════════════════
# Précision : 100m — suppression du numéro
# ══════════════════════════════════════════════════════════════════════════════

class TestMaskAddress100m:
    """Précision '100m' : premier segment avant la virgule, numéro supprimé."""

    def test_numero_simple_supprime(self):
        """'13 Rue de Rivoli, ...' → 'Rue de Rivoli'."""
        result = _mask_address("13 Rue de Rivoli, 75001 Paris, France", "100m")
        assert result == "Rue de Rivoli", f"Attendu 'Rue de Rivoli', obtenu '{result}'"

    def test_numero_bis_supprime(self):
        """'5 bis Rue du Temple, ...' → 'Rue du Temple'."""
        result = _mask_address("5 bis Rue du Temple, 75004 Paris", "100m")
        assert result == "Rue du Temple", f"Attendu 'Rue du Temple', obtenu '{result}'"

    def test_numero_ter_supprime(self):
        """'3 ter Avenue Montaigne' → 'Avenue Montaigne'."""
        result = _mask_address("3 ter Avenue Montaigne, 75008 Paris", "100m")
        assert result == "Avenue Montaigne", f"Attendu 'Avenue Montaigne', obtenu '{result}'"

    def test_numero_quater_supprime(self):
        """'2 quater Rue Oberkampf' → 'Rue Oberkampf'."""
        result = _mask_address("2 quater Rue Oberkampf, 75011 Paris", "100m")
        assert result == "Rue Oberkampf", f"Attendu 'Rue Oberkampf', obtenu '{result}'"

    def test_adresse_sans_numero_retournee_telle_quelle(self):
        """Sans numéro → premier segment avant la virgule, inchangé."""
        result = _mask_address("Rue de Rivoli, 75001 Paris, France", "100m")
        assert result == "Rue de Rivoli", f"Attendu 'Rue de Rivoli', obtenu '{result}'"

    def test_adresse_sans_virgule_retournee_telle_quelle(self):
        """Sans virgule et sans numéro → adresse complète."""
        result = _mask_address("Avenue des Champs-Élysées", "100m")
        assert result == "Avenue des Champs-Élysées", (
            f"Attendu 'Avenue des Champs-Élysées', obtenu '{result}'"
        )

    def test_numero_grand_supprime(self):
        """Numéro de rue > 99 supprimé correctement."""
        result = _mask_address("124 Boulevard Hausmann, 75009 Paris", "100m")
        assert result == "Boulevard Hausmann", f"Attendu 'Boulevard Hausmann', obtenu '{result}'"

    def test_seule_la_premiere_partie_avant_virgule_est_retournee(self):
        """Seule la partie avant la première virgule est retournée (sans numéro)."""
        result = _mask_address("7 Allée des Roses, Montpellier, Hérault, France", "100m")
        assert result == "Allée des Roses", f"Attendu 'Allée des Roses', obtenu '{result}'"


# ══════════════════════════════════════════════════════════════════════════════
# Précision : 1000m — ville / quartier seulement
# ══════════════════════════════════════════════════════════════════════════════

class TestMaskAddress1000m:
    """Précision '1000m' : retourne uniquement la ville ou le quartier."""

    def test_ville_extraite_apres_code_postal(self):
        """'75001 Paris' (dans adresse) → 'Paris'."""
        result = _mask_address("13 Rue de Rivoli, 75001 Paris, France", "1000m")
        assert result == "Paris", f"Attendu 'Paris', obtenu '{result}'"

    def test_france_ignoree_en_derniere_position(self):
        """'France' en fin d'adresse ignoré, partie précédente retournée."""
        result = _mask_address("Rue de Rivoli, Paris, France", "1000m")
        assert result == "Paris", f"Attendu 'Paris', obtenu '{result}'"

    def test_code_postal_extrait_partie_unique(self):
        """Adresse sans virgule avec code postal → ville extraite."""
        result = _mask_address("75008 Paris", "1000m")
        assert result == "Paris", f"Attendu 'Paris', obtenu '{result}'"

    def test_code_postal_5_chiffres_avec_arrondissement(self):
        """'75008 Paris 8ème, Île-de-France, France' → 'Île-de-France' (Île > Paris 8ème car antéposé)."""
        # Walk backwards : France → skip ; Île-de-France → not skip → retourné
        result = _mask_address("75008 Paris 8ème, Île-de-France, France", "1000m")
        assert result == "Île-de-France", f"Attendu 'Île-de-France', obtenu '{result}'"

    def test_partie_unique_sans_code_postal(self):
        """Adresse sans virgule et sans code postal → retournée telle quelle."""
        result = _mask_address("Montmartre", "1000m")
        assert result == "Montmartre", f"Attendu 'Montmartre', obtenu '{result}'"

    def test_ville_meridionale_extraite(self):
        """'06000 Nice' → 'Nice'."""
        result = _mask_address("5 Rue de la Paix, 06000 Nice, France", "1000m")
        assert result == "Nice", f"Attendu 'Nice', obtenu '{result}'"

    def test_code_postal_4_chiffres_non_reconnu_comme_postal(self):
        """Code postal 4 chiffres (non français) → adresse non découpée."""
        # Le regex ^\d{4,5}\s+ capture aussi 4 chiffres
        # "1000 Bruxelles" → re.match(r'^\d{4,5}\s+(.+)$', "1000 Bruxelles") → match → "Bruxelles"
        result = _mask_address("5 Rue Neuve, 1000 Bruxelles, Belgique", "1000m")
        # "Belgique" n'est pas dans _COUNTRY_NAMES → retourné directement
        assert result == "Belgique", f"Attendu 'Belgique' (non filtré), obtenu '{result}'"
