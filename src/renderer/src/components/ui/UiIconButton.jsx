import React, { forwardRef } from "react";

/** Icon-only control with consistent hit area (settings toolbars, etc.) */
const UiIconButton = forwardRef(function UiIconButton(
  { className = "", type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={["ui-icon-btn", className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
});

export default UiIconButton;
