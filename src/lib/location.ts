export type BrowserLocationOptions = {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
};

export type BrowserLocationReading = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
  formatted: string;
};

const DEFAULT_OPTIONS: Required<BrowserLocationOptions> = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

function formatCoordinates(latitude: number, longitude: number) {
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function humanizeGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Allow location access to clock in or out.";
    case error.POSITION_UNAVAILABLE:
      return "Location is currently unavailable. Check your signal or move to an open area.";
    case error.TIMEOUT:
      return "Timed out while waiting for your location. Try again.";
    default:
      return "Unable to determine your location.";
  }
}

export async function requireBrowserLocation(
  options: BrowserLocationOptions = {}
): Promise<BrowserLocationReading> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("This browser does not support location services.");
  }

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  return new Promise<BrowserLocationReading>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          reject(new Error("Received invalid coordinates from the browser."));
          return;
        }
        resolve({
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
          timestamp: position.timestamp,
          formatted: formatCoordinates(latitude, longitude),
        });
      },
      (error) => {
        reject(new Error(humanizeGeolocationError(error)));
      },
      mergedOptions
    );
  });
}

export function locationToPayload(location: BrowserLocationReading | string | undefined) {
  if (!location) return undefined;

  if (typeof location === "string") {
    return {
      location,
    } as const;
  }

  const { latitude, longitude, accuracy, formatted } = location;
  const coercedAccuracy = typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : undefined;

  return {
    location: formatted,
    latitude,
    longitude,
    accuracy: coercedAccuracy,
  } as const;
}

