import type { AppRoute } from '../../app/routes';

type TopBarProps = {
  route: AppRoute;
};

export const TopBar = ({ route }: TopBarProps): JSX.Element => {
  return (
    <header className="topbar">
      <div>
        <p className="section-kicker">Local HiFi Library</p>
        <h1>{route.label}</h1>
        <p className="topbar-description">{route.description}</p>
      </div>
      <div className="system-pill">
        <span>44.1 kHz</span>
        <span>24-bit</span>
        <span>Idle</span>
      </div>
    </header>
  );
};
