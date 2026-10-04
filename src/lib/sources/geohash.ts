const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash of a point (Ticketmaster's `geoPoint` parameter). */
export function geohash(lat: number, lng: number, precision = 9): string {
  let latLo = -90;
  let latHi = 90;
  let lngLo = -180;
  let lngHi = 180;
  let out = "";
  let bits = 0;
  let value = 0;
  let evenBit = true;
  while (out.length < precision) {
    if (evenBit) {
      const mid = (lngLo + lngHi) / 2;
      value = (value << 1) | (lng >= mid ? 1 : 0);
      if (lng >= mid) lngLo = mid;
      else lngHi = mid;
    } else {
      const mid = (latLo + latHi) / 2;
      value = (value << 1) | (lat >= mid ? 1 : 0);
      if (lat >= mid) latLo = mid;
      else latHi = mid;
    }
    evenBit = !evenBit;
    if (++bits === 5) {
      out += BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return out;
}
