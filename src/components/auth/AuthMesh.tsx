// Subtle blue mesh that melts into the page background — pure decoration, behind
// content, non-interactive, and static. Shared by the auth surfaces (login/signup/verify).
export function AuthMesh() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute -top-28 -left-24 h-[440px] w-[440px] rounded-full blur-[95px] opacity-[0.20]"
        style={{ background: "radial-gradient(circle at 30% 30%, #3b82f6, transparent 70%)" }}
      />
      <div
        className="absolute top-[28%] -right-32 h-[500px] w-[500px] rounded-full blur-[110px] opacity-[0.16]"
        style={{ background: "radial-gradient(circle at 60% 40%, #2563eb, #60a5fa 42%, transparent 72%)" }}
      />
      <div
        className="absolute -bottom-44 left-[18%] h-[420px] w-[560px] rounded-full blur-[120px] opacity-[0.13]"
        style={{ background: "radial-gradient(ellipse at center, #38bdf8, transparent 70%)" }}
      />
    </div>
  );
}
