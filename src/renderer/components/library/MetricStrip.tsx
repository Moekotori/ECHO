type Metric = {
  label: string;
  value: string;
};

type MetricStripProps = {
  metrics: Metric[];
};

export const MetricStrip = ({ metrics }: MetricStripProps): JSX.Element => {
  return (
    <div className="metric-strip">
      {metrics.map((metric) => (
        <div className="metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
};
