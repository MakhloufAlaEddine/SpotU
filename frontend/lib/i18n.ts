export type Lang = 'fr' | 'en';

const translations: Record<string, Record<Lang, string>> = {
  // Nav
  map: { fr: 'Carte', en: 'Map' },
  search: { fr: 'Recherche', en: 'Search' },
  create: { fr: 'Créer', en: 'Create' },
  bookings: { fr: 'Réservations', en: 'Bookings' },
  profile: { fr: 'Profil', en: 'Profile' },
  // Auth
  login: { fr: 'Se connecter', en: 'Sign in' },
  register: { fr: "S'inscrire", en: 'Sign up' },
  logout: { fr: 'Se déconnecter', en: 'Log out' },
  email: { fr: 'Email', en: 'Email' },
  password: { fr: 'Mot de passe', en: 'Password' },
  fullName: { fr: 'Nom complet', en: 'Full name' },
  noAccount: { fr: 'Pas encore de compte ?', en: 'No account yet?' },
  hasAccount: { fr: 'Déjà un compte ?', en: 'Already have an account?' },
  orContinueWith: { fr: 'Ou continuer avec', en: 'Or continue with' },
  googleSignIn: { fr: 'Continuer avec Google', en: 'Continue with Google' },
  welcomeBack: { fr: 'Bon retour !', en: 'Welcome back!' },
  createAccount: { fr: 'Créer un compte', en: 'Create account' },
  // Map
  nearYou: { fr: 'Autour de vous', en: 'Near you' },
  noPoints: { fr: 'Aucun SpotMe dans cette zone', en: 'No SpotYou in this area' },
  loadingMap: { fr: 'Chargement de la carte…', en: 'Loading map…' },
  enableLocation: { fr: 'Activer la localisation', en: 'Enable location' },
  locationNeeded: { fr: 'Accès à la localisation requis', en: 'Location access required' },
  // Search
  searchPlaceholder: { fr: 'Rechercher une activité…', en: 'Search an activity…' },
  radius: { fr: 'Rayon', en: 'Radius' },
  km: { fr: 'km', en: 'km' },
  results: { fr: 'résultats', en: 'results' },
  SpotYou: { fr: 'SpotYou', en: 'SpotYou' },
  coaches: { fr: 'Coachs', en: 'Coaches' },
  noResults: { fr: 'Aucun résultat', en: 'No results' },
  // Create
  createSpotYou: { fr: 'Créer un SpotYou', en: 'Create SpotYou' },
  SpotYouTitle: { fr: 'Titre', en: 'Title' },
  SpotYouDesc: { fr: 'Description (optionnel)', en: 'Description (optional)' },
  selectTags: { fr: 'Sélectionner des tags', en: 'Select tags' },
  selectDomain: { fr: 'Domaine', en: 'Domain' },
  selectLocation: { fr: 'Choisir une position', en: 'Pick a location' },
  locationHint: { fr: 'Appuyez sur la carte pour choisir un emplacement', en: 'Tap the map to choose a location' },
  precision: { fr: 'Précision de localisation', en: 'Location precision' },
  precisionExact: { fr: 'Exacte', en: 'Exact' },
  precision100m: { fr: '~100m', en: '~100m' },
  precision1000m: { fr: '~1km', en: '~1km' },
  expiresIn: { fr: 'Expire dans', en: 'Expires in' },
  neverExpires: { fr: 'Ne jamais expirer', en: 'Never expires' },
  hours: { fr: 'heures', en: 'hours' },
  publish: { fr: 'Publier', en: 'Publish' },
  selectLocationFirst: { fr: 'Veuillez sélectionner un emplacement', en: 'Please select a location' },
  // Coach
  coachProfile: { fr: 'Profil Coach', en: 'Coach Profile' },
  bookSession: { fr: 'Réserver une séance', en: 'Book a session' },
  perHour: { fr: '/ heure', en: '/ hour' },
  duration: { fr: 'Durée', en: 'Duration' },
  minutes: { fr: 'min', en: 'min' },
  maxParticipants: { fr: 'Max. participants', en: 'Max participants' },
  reviews: { fr: 'Avis', en: 'Reviews' },
  noReviews: { fr: 'Aucun avis pour le moment', en: 'No reviews yet' },
  // Bookings
  myBookings: { fr: 'Mes réservations', en: 'My bookings' },
  coachBookings: { fr: 'Réservations reçues', en: 'Received bookings' },
  noBookings: { fr: 'Aucune réservation', en: 'No bookings' },
  pending: { fr: 'En attente', en: 'Pending' },
  confirmed: { fr: 'Confirmée', en: 'Confirmed' },
  completed: { fr: 'Terminée', en: 'Completed' },
  cancelled: { fr: 'Annulée', en: 'Cancelled' },
  payNow: { fr: 'Payer maintenant', en: 'Pay now' },
  paid: { fr: 'Payée', en: 'Paid' },
  commission: { fr: 'Commission plateforme', en: 'Platform fee' },
  // Profile
  myProfile: { fr: 'Mon profil', en: 'My profile' },
  editProfile: { fr: 'Modifier le profil', en: 'Edit profile' },
  bio: { fr: 'Bio', en: 'Bio' },
  language: { fr: 'Langue', en: 'Language' },
  becomeCoach: { fr: 'Devenir coach', en: 'Become a coach' },
  alreadyCoach: { fr: 'Vous êtes coach', en: 'You are a coach' },
  coachBadge: { fr: 'Coach', en: 'Coach' },
  adminBadge: { fr: 'Admin', en: 'Admin' },
  verifiedBadge: { fr: 'Vérifié', en: 'Verified' },
  mySpotYou: { fr: 'Mes SpotMe', en: 'My SpotYou' },
  myServices: { fr: 'Mes services', en: 'My services' },
  addService: { fr: 'Ajouter un service', en: 'Add service' },
  adminPanel: { fr: 'Panneau admin', en: 'Admin panel' },
  // Admin
  adminTitle: { fr: 'Administration SpotU', en: 'SpotU Administration' },
  stats: { fr: 'Statistiques', en: 'Statistics' },
  totalUsers: { fr: 'Utilisateurs', en: 'Users' },
  totalCoaches: { fr: 'Coachs', en: 'Coaches' },
  totalSpotYou: { fr: 'SpotYou actifs', en: 'Active SpotYou' },
  totalBookings: { fr: 'Réservations', en: 'Bookings' },
  gmv: { fr: 'Volume d\'affaires', en: 'Gross volume' },
  platformFee: { fr: 'Commission plateforme', en: 'Platform fees' },
  manageUsers: { fr: 'Gérer les utilisateurs', en: 'Manage users' },
  manageDomains: { fr: 'Gérer les domaines', en: 'Manage domains' },
  verifyCoach: { fr: 'Vérifier', en: 'Verify' },
  makeAdmin: { fr: 'Rendre admin', en: 'Make admin' },
  // Common
  loading: { fr: 'Chargement…', en: 'Loading…' },
  error: { fr: 'Erreur', en: 'Error' },
  success: { fr: 'Succès', en: 'Success' },
  cancel: { fr: 'Annuler', en: 'Cancel' },
  confirm: { fr: 'Confirmer', en: 'Confirm' },
  save: { fr: 'Enregistrer', en: 'Save' },
  delete: { fr: 'Supprimer', en: 'Delete' },
  back: { fr: 'Retour', en: 'Back' },
  done: { fr: 'Terminé', en: 'Done' },
  optional: { fr: 'optionnel', en: 'optional' },
  location: { fr: 'Localisation', en: 'Location' },
  at: { fr: 'à', en: 'at' },
  by: { fr: 'par', en: 'by' },
  price: { fr: 'Prix', en: 'Price' },
  // Payment
  paymentSuccess: { fr: 'Paiement réussi !', en: 'Payment successful!' },
  paymentSuccessDesc: { fr: 'Votre réservation est confirmée.', en: 'Your booking is confirmed.' },
  paymentPending: { fr: 'Paiement en cours…', en: 'Payment processing…' },
  paymentFailed: { fr: 'Paiement échoué', en: 'Payment failed' },
  viewBooking: { fr: 'Voir ma réservation', en: 'View booking' },
  // Domain labels
  sport: { fr: 'Sport', en: 'Sport' },
  coaching: { fr: 'Coaching', en: 'Coaching' },
  service: { fr: 'Services', en: 'Services' },
  social: { fr: 'Social', en: 'Social' },
};

let currentLang: Lang = 'fr';

export function setLang(lang: Lang) {
  currentLang = lang;
}

export function getLang(): Lang {
  return currentLang;
}

export function t(key: string, lang?: Lang): string {
  const l = lang || currentLang;
  return translations[key]?.[l] ?? translations[key]?.['fr'] ?? key;
}
