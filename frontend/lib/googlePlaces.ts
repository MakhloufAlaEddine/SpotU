// Google Places & Geocoding API utility
const GOOGLE_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY ||
  'AIzaSyDGvvgAEkiNhVC5rqSy0u1CX4iWRSE_m0I';

export type PlacePrediction = {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
};

export type PlaceDetails = {
  lat: number;
  lng: number;
  address: string;
  name: string;
};

/** Autocomplete — retourne des suggestions de lieux, adresses et commerces */
export async function searchPlaces(input: string): Promise<PlacePrediction[]> {
  if (!input || input.length < 2) return [];
  try {
    const params = new URLSearchParams({
      input,
      key: GOOGLE_KEY,
      language: 'fr',
      // prioritise France sans restreindre
      components: 'country:fr',
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const data = await res.json();
    if (data.status === 'ZERO_RESULTS') {
      // fallback sans restriction pays
      const p2 = new URLSearchParams({ input, key: GOOGLE_KEY, language: 'fr' });
      const r2 = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${p2}`);
      const d2 = await r2.json();
      if (d2.status !== 'OK') return [];
      return d2.predictions.map((p: any) => ({
        place_id: p.place_id,
        description: p.description,
        main_text: p.structured_formatting?.main_text || p.description,
        secondary_text: p.structured_formatting?.secondary_text || '',
      }));
    }
    if (data.status !== 'OK') return [];
    return data.predictions.map((p: any) => ({
      place_id: p.place_id,
      description: p.description,
      main_text: p.structured_formatting?.main_text || p.description,
      secondary_text: p.structured_formatting?.secondary_text || '',
    }));
  } catch {
    return [];
  }
}

/** Place Details — retourne les coordonnées et l'adresse formatée d'un lieu */
export async function getPlaceDetails(place_id: string): Promise<PlaceDetails | null> {
  try {
    const params = new URLSearchParams({
      place_id,
      key: GOOGLE_KEY,
      fields: 'geometry,formatted_address,name',
      language: 'fr',
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const data = await res.json();
    if (data.status !== 'OK') return null;
    const r = data.result;
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      address: r.formatted_address || r.name,
      name: r.name || r.formatted_address,
    };
  } catch {
    return null;
  }
}

/** Geocoding inverse — retourne l'adresse d'une coordonnée GPS */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: GOOGLE_KEY,
      language: 'fr',
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params}`
    );
    const data = await res.json();
    if (data.status === 'OK' && data.results?.length > 0) {
      return data.results[0].formatted_address;
    }
    return '';
  } catch {
    return '';
  }
}
