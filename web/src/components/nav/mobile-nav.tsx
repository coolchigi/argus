"use client";

import { Drawer } from "@base-ui/react/drawer";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "@/components/nav/sidebar";

/**
 * Below 1024px the sidebar lives in a Base UI Drawer. It fades in place
 * (Argus doesn't slide, PERFORMATIVE section 6). A swipe left still dismisses it.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} swipeDirection="left">
      <Drawer.Trigger
        aria-label="Open menu"
        className="-ml-1.5 inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-sunk hover:text-ink-1 lg:hidden"
      >
        <Menu aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/40 opacity-100 transition-opacity duration-[120ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-black/60" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-stretch justify-start">
          <Drawer.Popup className="relative h-full w-[280px] max-w-[85vw] border-r border-hairline bg-surface opacity-100 outline-none transition-opacity duration-[120ms] [transform:translateX(var(--drawer-swipe-movement-x,0px))] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[swiping]:select-none">
            <Drawer.Title className="sr-only">Menu</Drawer.Title>
            <Drawer.Close
              aria-label="Close menu"
              className="absolute right-2 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-sunk hover:text-ink-1"
            >
              <X aria-hidden className="h-4 w-4" strokeWidth={1.75} />
            </Drawer.Close>
            <Sidebar onNavigate={() => setOpen(false)} />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
