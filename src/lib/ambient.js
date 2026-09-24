// Ambient air model: drives visual effects only (condensation, mist, vapor).
// It is not part of the heat-exchanger energy balance in physics.js.

/** Dew point (°C) from air temperature (°C) and relative humidity (%), Magnus–Tetens. */
export function dewPoint(Ta, RH) {
  const a = 17.62, b = 243.12;
  const g = Math.log(Math.max(RH, 1) / 100) + (a * Ta) / (b + Ta);
  return (b * g) / (a - g);
}
