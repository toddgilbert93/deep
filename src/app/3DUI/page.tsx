import { Button3D } from "./_lib/button/Button3D";

export default function Page() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-16 px-8 py-20">
      <header className="text-center">
        <p className="font-mono text-xs tracking-[0.28em] text-neutral-500 uppercase">
          3DUI
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Button</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Hard corners · tilt X Y Z · origin center
        </p>
      </header>

      <Button3D>Button</Button3D>
    </main>
  );
}
