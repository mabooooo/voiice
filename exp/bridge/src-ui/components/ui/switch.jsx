export function Switch({ checked, onCheckedChange, disabled, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`ui-switch ${checked ? 'ui-switch--checked' : ''}`}
      onClick={() => onCheckedChange?.(!checked)}
    >
      <span className="ui-switch__thumb" />
    </button>
  )
}
