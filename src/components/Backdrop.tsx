export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop__glow backdrop__glow--one" />
      <div className="backdrop__glow backdrop__glow--two" />
      <div className="backdrop__caustics" />
      <div className="porthole">
        <div className="porthole__glass">
          <span className="distant-whale">⌁</span>
          <i className="bubble bubble--one" />
          <i className="bubble bubble--two" />
          <i className="bubble bubble--three" />
        </div>
      </div>
      <div className="server-bank server-bank--left">
        {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
      </div>
      <div className="server-bank server-bank--right">
        {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
      </div>
      <div className="floor-grid" />
      <div className="foreground-wave foreground-wave--back" />
      <div className="foreground-wave foreground-wave--front" />
    </div>
  );
}
