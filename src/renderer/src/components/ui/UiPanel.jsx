import React from "react";

/** Optional wrapper: combine with `.glass-panel` for elevated surfaces */
export default function UiPanel({
  as: Tag = "div",
  glass = true,
  className = "",
  ...rest
}) {
  const cls = [glass ? "glass-panel" : "", "ui-panel", className]
    .filter(Boolean)
    .join(" ");
  return <Tag className={cls} {...rest} />;
}
