import type { ReactNode } from "react";
import { Button3D, Button3DGroup } from "@/app/3DUI/_lib/button/Button3D";
import { Card3D } from "@/app/3DUI/_lib/card/Card3D";
import { CarouselDemo } from "@/app/3DUI/_lib/carousel/CarouselDemo";
import { Chrome3D } from "@/app/3DUI/_lib/chrome/Chrome3D";
import { ICON3D_NAMES, Icon3D } from "@/app/3DUI/_lib/icon/Icon3D";
import { Image3D } from "@/app/3DUI/_lib/image/Image3D";
import { Text3D } from "@/app/3DUI/_lib/text-extrude/Text3D";
import { TextShadow3D } from "@/app/3DUI/_lib/text-shadow/TextShadow3D";

const elements: {
  name: string;
  description: string;
  preview: ReactNode;
}[] = [
  {
    name: "Button",
    description: "Hard corners. Off-axis rest; grouped buttons each get a different tilt.",
    preview: (
      <Button3DGroup>
        <Button3D>Save</Button3D>
        <Button3D>Edit</Button3D>
        <Button3D>Share</Button3D>
      </Button3DGroup>
    ),
  },
  {
    name: "Carousel",
    description: "Tab/button group on a ring. Holds 3–8 hard-corner block buttons.",
    preview: <CarouselDemo />,
  },
  {
    name: "Card",
    description: "One box. Gentle tilt so the connected sides read.",
    preview: (
      <Card3D>
        <div className="text-left">
          <p className="text-sm font-semibold tracking-wide">Title</p>
          <p className="mt-1 text-xs text-neutral-600">Body copy on a static slab.</p>
        </div>
      </Card3D>
    ),
  },
  {
    name: "Image",
    description: "Stronger scene lighting over any 2D image. No frame.",
    preview: (
      <Image3D>
        <img src="/3dui/image-preview.svg" alt="Landscape" />
      </Image3D>
    ),
  },
  {
    name: "Chrome",
    description: "Page sits back in a hole. Dark side walls, no frame.",
    preview: (
      <div className="relative h-[360px] w-[min(100%,420px)] bg-neutral-200">
        <Chrome3D>
          <div className="flex h-full flex-col text-neutral-900">
            <header className="border-b border-neutral-400 px-4 py-2 text-xs font-semibold tracking-wide">
              Page
            </header>
            <div className="flex-1 space-y-2 p-4">
              <div className="h-2 w-3/4 bg-neutral-400" />
              <div className="h-2 w-full bg-neutral-300" />
              <div className="h-2 w-5/6 bg-neutral-300" />
              <div className="h-2 w-2/3 bg-neutral-400" />
            </div>
          </div>
        </Chrome3D>
      </div>
    ),
  },
  {
    name: "Icon",
    description: "Box-extruded glyphs. Slow Y-axis tilt.",
    preview: (
      <div className="flex max-w-[320px] flex-wrap items-center justify-center gap-4">
        {ICON3D_NAMES.map((name) => (
          <Icon3D key={name} name={name} />
        ))}
      </div>
    ),
  },
  {
    name: "Text",
    description: "Tilted box extrusion. 32px and up.",
    preview: <Text3D fontSize={48}>DEPTH</Text3D>,
  },
  {
    name: "Text shadow",
    description: "Hard offset extrusion. 16–24px, no tilt.",
    preview: <TextShadow3D fontSize={20}>Caption</TextShadow3D>,
  },
];

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-8 py-16">
      <header className="flex items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs tracking-[0.28em] text-neutral-500 uppercase">
            3DUI
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Library</h1>
        </div>
        <p className="font-mono text-xs text-neutral-500">
          {elements.length} element{elements.length === 1 ? "" : "s"}
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        {elements.map((element) => (
          <article
            key={element.name}
            className="flex flex-col border border-neutral-800 bg-neutral-900"
          >
            <div className="grid min-h-[520px] place-items-center bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.07),transparent_62%)]">
              {element.preview}
            </div>
            <footer className="border-t border-neutral-800 px-5 py-4">
              <h2 className="text-lg font-medium tracking-tight">{element.name}</h2>
              <p className="mt-1 text-sm text-neutral-400">{element.description}</p>
            </footer>
          </article>
        ))}
      </section>
    </main>
  );
}
