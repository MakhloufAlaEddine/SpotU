const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY || '';
const BASE = 'https://maps.googleapis.com/maps/api';

export type PlaceSuggestion = {
  place_id: string;
  main_text: string;
  secondary_text: string;
  description: string;
};

export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  if (!query || query.length < 2) return [];
  try {
    // First try with French country restriction
    const params = new URLSearchParams({
      input: query,
      key: API_KEY,
      language: 'fr',
      components: 'country:fr',
    });
    const res = await fetch(`${BASE}/place/autocomplete/json?${params}`);
    const data = await res.json();
    if (data.predictions && data.predictions.length > 0) {
      return data.predictions.map((p: any) => ({
        place_id: p.place_id,
        main_text: p.structured_formatting?.main_text || p.description,
        secondary_text: p.structured_formatting?.secondary_text || '',
        description: p.description,
      }));
    }
    // Retry without country restriction for international queries
    const params2 = new URLSearchParams({ input: query, key: API_KEY, language: 'fr' });
    const res2 = await fetch(`${BASE}/place/autocomplete/json?${params2}`);
    const data2 = await res2.json();
    return (data2.predictions || []).map((p: any) => ({
      place_id: p.place_id,
      main_text: p.structured_formatting?.main_text || p.description,
      secondary_text: p.structured_formatting?.secondary_text || '',
      description: p.description,
    }));
  } catch {
    return [];
  }
}

export async function getPlaceDetails(
  placeId: string
): Promise<{ lat: number; lng: number; address: string } | null> {
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'geometry,formatted_address',
      key: API_KEY,
      language: 'fr',
    });
    const res = await fetch(`${BASE}/place/details/json?${params}`);
    const data = await res.json();
    if (data.status !== 'OK') return null;
    const loc = data.result?.geometry?.location;
    if (!loc) return null;
    return {
      lat: loc.lat,
      lng: loc.lng,
      address: data.result?.formatted_address || '',
    };
  } catch {
    return null;
  }
}

export async function reverseGeocodeGoogle(lat: number, lng: number): Promise<string> {
  try {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: API_KEY,
      language: 'fr',
    });
    const res = await fetch(`${BASE}/geocode/json?${params}`);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results?.length) return '';
    return data.results[0]?.formatted_address || '';
  } catch {
    return '';
  }
}
