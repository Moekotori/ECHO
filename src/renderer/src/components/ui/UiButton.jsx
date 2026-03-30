import React, { forwardRef } from "react";

/**
 * Settings / forms: primary (gradient), secondary (glass), danger (outline rose).
 * Does not replace player `.btn` circles — those stay on existing classes.
 */
const UiButton = forwardRef(function UiButton(
  { variant = "secondary", size = "md", className = "", type = "button", ...rest },
  ref,
) {
  const sizeClass =
    size === "sm"
      ? "ui-btn--sm"
      : size === "compact"
        ? "ui-btn--compact"
        : "ui-btn--md";
  const comp = [
    "ui-btn",
    `ui-btn--${variant}`,
    sizeClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button ref={ref} type={type} className={comp} {...rest} />;
});

export default UiButton;
