/**
 * Mini-mapa fixo de um ponto (azulejos do OpenStreetMap à volta do ponto, sem carregar o mapa interativo).
 * Serve para mostrar a localização enviada no chat; tocar abre o mapa do telemóvel.
 */
const Z = 16;
const T = 256;
const px = (lat: number, lng: number) => {
  const n = 2 ** Z;
  const x = ((lng + 180) / 360) * n * T;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * T;
  return { x, y };
};

export default function TileMap({ lat, lng, width = 240, height = 140, className = '' }: { lat: number; lng: number; width?: number; height?: number; className?: string }) {
  const c = px(lat, lng);
  const left = c.x - width / 2;
  const top = c.y - height / 2;
  const tiles: { x: number; y: number }[] = [];
  for (let ty = Math.floor(top / T); ty <= Math.floor((top + height) / T); ty++) {
    for (let tx = Math.floor(left / T); tx <= Math.floor((left + width) / T); tx++) tiles.push({ x: tx, y: ty });
  }
  return (
    <div className={`relative overflow-hidden bg-zinc-200 ${className}`} style={{ width, height }} aria-hidden>
      {tiles.map((t) => (
        <img key={`${t.x}/${t.y}`} src={`https://tile.openstreetmap.org/${Z}/${t.x}/${t.y}.png`} alt="" loading="lazy" draggable={false} className="absolute max-w-none" style={{ width: T, height: T, left: t.x * T - left, top: t.y * T - top }} />
      ))}
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
        <svg width="30" height="38" viewBox="0 0 30 38" fill="none"><path d="M15 37C15 37 28 24.5 28 14.5a13 13 0 1 0-26 0C2 24.5 15 37 15 37Z" fill="#d6334f" stroke="#fff" strokeWidth="2.5" /><circle cx="15" cy="14.5" r="5" fill="#fff" /></svg>
      </span>
    </div>
  );
}
