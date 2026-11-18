// The editor's menus as data (web built AntD `MenuProps['items']`), drawn with the shadcn dropdown menu.
import type { ReactNode } from 'react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/aicser-ui/dropdown-menu';

export type MenuEntry =
  | {
      kind?: 'item';
      key: string;
      label: ReactNode;
      icon?: ReactNode;
      title?: string;
      danger?: boolean;
      onClick: () => void;
    }
  | { kind: 'sub'; key: string; label: ReactNode; children: MenuEntry[] }
  | { kind: 'label'; key: string; label: ReactNode }
  | { kind: 'divider'; key: string };

export function MenuItems({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case 'divider':
            return <DropdownMenuSeparator key={item.key} />;
          case 'label':
            return (
              <DropdownMenuLabel key={item.key} className="text-xs font-normal text-muted-foreground">
                {item.label}
              </DropdownMenuLabel>
            );
          case 'sub':
            return (
              <DropdownMenuSub key={item.key}>
                <DropdownMenuSubTrigger>{item.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <MenuItems items={item.children} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          default:
            return (
              <DropdownMenuItem
                key={item.key}
                title={item.title}
                variant={item.danger ? 'destructive' : 'default'}
                onSelect={item.onClick}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            );
        }
      })}
    </>
  );
}
