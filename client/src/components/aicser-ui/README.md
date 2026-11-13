# Aicser UI (pilot: Docs, Slides)

The desktop app's design system on the web: shadcn/ui components on Radix with the Aicser tokens, styled by
Tailwind through `tailwind.ui.config.ts` (its own build, `src/styles/aicser-ui.css`). Every class only applies
inside an element with the `aicser-ui` class, so put `<AicserUi>` (scope.tsx) around a page that uses these
components; portals (menus, popovers, tooltips) add the scope themselves. Never mix AntD into these pages.

Copied from aicser-desktop `src/components/ui/` (Tailwind 4) and converted to Tailwind 3 syntax; open/close
animations are left out.
