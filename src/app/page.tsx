import Image from "next/image";
import { GoDeepForm } from "@/app/_components/go-deep-form";

export default function Home() {
  return (
    <div className="desperado-theme flex min-h-full flex-1 flex-col">
      <header className="flex flex-col items-center px-8 pt-8">
        <h1>
          <Image
            src="/deep-logo.svg"
            alt="Deep"
            width={180}
            height={107}
            priority
            className="[mask-image:linear-gradient(to_bottom,black_28%,transparent_88%)] [-webkit-mask-image:linear-gradient(to_bottom,black_28%,transparent_88%)]"
          />
        </h1>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-8 pb-24">
        <GoDeepForm />
      </main>
    </div>
  );
}
