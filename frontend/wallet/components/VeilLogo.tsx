export function VeilLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Veil"
    >
      {/* Outer circle */}
      <circle cx="16" cy="16" r="15" stroke="#FDDA24" strokeWidth="1.5" />
      {/* Fingerprint arcs — simplified, brand-consistent */}
      <path
        d="M16 8C11.582 8 8 11.582 8 16"
        stroke="#FDDA24"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 11C13.239 11 11 13.239 11 16"
        stroke="#FDDA24"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 14C14.895 14 14 14.895 14 16"
        stroke="#FDDA24"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 8C20.418 8 24 11.582 24 16"
        stroke="rgba(253,218,36,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 11C18.761 11 21 13.239 21 16"
        stroke="rgba(253,218,36,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 14C17.105 14 18 14.895 18 16"
        stroke="rgba(253,218,36,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Centre dot */}
      <circle cx="16" cy="16" r="1.5" fill="#FDDA24" />
    </svg>
  )
}
