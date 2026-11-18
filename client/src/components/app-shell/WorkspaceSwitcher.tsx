'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Building2, ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { Button } from '@/components/aicser-ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/aicser-ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/aicser-ui/dropdown-menu';
import { Input } from '@/components/aicser-ui/input';
import { Label } from '@/components/aicser-ui/label';
import { Textarea } from '@/components/aicser-ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/aicser-ui/tooltip';
import { asDynamicModule } from '@/utils/asDynamicModule';
import { ApiError, handlePlanLimitError } from '@/utils/api';
import { getOrganizationBranding } from '@/utils/orgBranding';
import { getChatHref } from '@/utils/appPaths';
import { dataSourceKeys } from '@/hooks/dataSourceKeys';
import { useCreateOrganization, useOrganizations } from '@/hooks/useOrganizations';
import { useCreateProject, useProjects } from '@/hooks/useProjects';
import { useWorkspaceConfig } from '@/hooks/useWorkspaceConfig';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConversationStore } from '@/stores/useConversationStore';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

const ProjectSelectorModal = dynamic(
  () => import('@/ee-lazy/ProjectSelectorModal').then((m) => asDynamicModule(m.ProjectSelectorModal, () => null)),
  { ssr: false }
) as React.ComponentType<{
  open?: boolean;
  onClose?: () => void;
  onProjectChange?: (projectId: string | number) => void;
  onCreateNew?: () => void;
}>;

type IconableEntity = Parameters<typeof getOrganizationBranding>[0] & {
  icon_emoji?: string | null;
  color?: string | null;
};

/** Uploaded logo, then the chosen emoji, then the default icon (in the entity's colour). */
function EntityIcon({ entity, fallback: Fallback }: { entity: object | null | undefined; fallback: typeof Folder }) {
  const { logoUrl, name } = getOrganizationBranding(entity as IconableEntity | null | undefined);
  // A logo that doesn't load (expired signed URL, removed file) falls back to the icon, never a broken image.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  if (logoUrl && logoUrl !== failedUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- org branding may be a data URI or a signed URL
    return (
      <img
        src={logoUrl}
        alt={name ? `${name} logo` : ''}
        className="size-4 shrink-0 rounded object-contain"
        draggable={false}
        onError={() => setFailedUrl(logoUrl)}
      />
    );
  }
  const { icon_emoji: emoji, color } = (entity ?? {}) as IconableEntity;
  if (emoji) return <span className="shrink-0 text-sm leading-none">{emoji}</span>;
  return (
    <Fallback aria-hidden className="text-primary-hover dark:text-primary" style={color ? { color } : undefined} />
  );
}

const chip =
  'h-8 max-w-[min(280px,28vw)] min-w-0 gap-1.5 px-2 text-sm font-medium [&>span]:truncate [&_svg.chevron]:size-3 [&_svg.chevron]:opacity-70';

function errorDetail(error: unknown): string | null {
  return error instanceof ApiError && error.message ? error.message : null;
}

/**
 * Header trail "organization › project" (Enterprise): switch either one, create a project, and the first
 * organization for someone who has none (SaaS only; self-hosted servers have one organization).
 */
export function WorkspaceSwitcher({ compact }: { compact: boolean }) {
  const t = useTranslations('header');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const userId = (user as { id?: string } | null)?.id;

  const { currentOrganization, setCurrentOrganization } = useOrganizationStore();
  const { organizations, isLoading: orgLoading } = useOrganizations({ enabled: true });
  const { allowsCreateOrg } = useWorkspaceConfig({ enabled: true });
  const createOrg = useCreateOrganization();
  const { currentProject, selectProject, clearProject } = useProjectStore();
  const { projects, isLoading: projectsLoading } = useProjects(currentOrganization?.id);
  const createProject = useCreateProject();
  const { createConversation } = useConversationStore();

  const [projectPickerOpen, setProjectPickerOpen] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [createOrgOpen, setCreateOrgOpen] = React.useState(false);

  const resetProjectScopedData = React.useCallback(() => {
    useDataSourceStore.getState().select(null);
    void queryClient.invalidateQueries({ queryKey: dataSourceKeys.all });
  }, [queryClient]);

  // Pick an organization (or ask for a first one); drop a stale one.
  React.useEffect(() => {
    if (!userId || orgLoading) return;
    if (organizations.length === 0) {
      if (currentOrganization) setCurrentOrganization(null);
      if (allowsCreateOrg) setCreateOrgOpen(true);
      return;
    }
    if (!currentOrganization || !organizations.some((org) => org.id === currentOrganization.id)) {
      setCurrentOrganization(organizations[0]);
    }
  }, [userId, orgLoading, organizations, currentOrganization, setCurrentOrganization, allowsCreateOrg]);

  // A project from another organization (left in storage) is cleared.
  React.useEffect(() => {
    if (!currentOrganization) return;
    if (currentProject?.organization_id && String(currentProject.organization_id) !== String(currentOrganization.id)) {
      clearProject();
    }
  }, [currentOrganization, currentProject, clearProject]);

  // Pick the first project when none (or a deleted one) is selected.
  React.useEffect(() => {
    if (projectsLoading) return;
    if (projects.length === 0) {
      if (currentProject) clearProject();
      return;
    }
    if (!currentProject || !projects.some((p) => String(p.id) === String(currentProject.id)))
      selectProject(projects[0]);
  }, [projectsLoading, projects, currentProject, selectProject, clearProject]);

  const changeProject = (projectId: number | string) => {
    const project = projects.find((p) => String(p.id) === String(projectId));
    if (!project) {
      toast.error(t('switch_failed'));
      return;
    }
    selectProject(project);
    resetProjectScopedData();
    void useConversationStore.getState().loadConversations(String(project.id));
    toast.success(t('switched_to', { name: project.name }), { duration: 2000 });
  };

  const changeOrganization = (organizationId: string) => {
    const org = organizations.find((item) => String(item.id) === organizationId);
    if (!org) {
      toast.error(t('organization_switch_failed'));
      return;
    }
    if (String(currentOrganization?.id) === organizationId) return;
    setCurrentOrganization(org);
    clearProject();
    resetProjectScopedData();
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    toast.success(t('switched_organization', { name: org.name }), { duration: 2000 });
  };

  const projectTitle = currentProject
    ? currentProject.is_private && currentProject.owner_name
      ? `${currentProject.name} — private, owned by ${currentProject.owner_name}`
      : `${currentProject.name} — ${t('switch_project')}`
    : t('switch_project');

  return (
    <>
      {currentOrganization ? (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('org_settings')}
                onClick={() => router.push('/settings?tab=organization')}
              >
                <EntityIcon entity={currentOrganization} fallback={Building2} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('org_settings')}</TooltipContent>
          </Tooltip>
          {compact ? null : organizations.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className={chip}
                  title={`${currentOrganization.name} — ${t('switch_organization')}`}
                >
                  <span>{currentOrganization.name}</span>
                  <ChevronDown className="chevron" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup value={String(currentOrganization.id)} onValueChange={changeOrganization}>
                  {organizations.map((org) => (
                    <DropdownMenuRadioItem key={org.id} value={String(org.id)}>
                      <EntityIcon entity={org} fallback={Building2} />
                      <span className="truncate">{org.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="max-w-[min(280px,28vw)] truncate px-1 text-sm font-medium">
              {currentOrganization.name}
            </span>
          )}
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      ) : null}

      <Button variant="ghost" className={chip} title={projectTitle} onClick={() => setProjectPickerOpen(true)}>
        <EntityIcon entity={currentProject} fallback={Folder} />
        <span>{currentProject ? currentProject.name : t('select_project')}</span>
        <ChevronDown className="chevron" aria-hidden />
      </Button>

      <ProjectSelectorModal
        open={projectPickerOpen}
        onClose={() => setProjectPickerOpen(false)}
        onProjectChange={changeProject}
        onCreateNew={() => setCreateProjectOpen(true)}
      />

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        organizationName={currentOrganization?.name ?? null}
        saving={createProject.isPending}
        onCreate={async (values) => {
          try {
            const project = await createProject.mutateAsync({
              ...values,
              organization_id: currentOrganization?.id,
            } as Parameters<typeof createProject.mutateAsync>[0]);
            if (!project) return;
            selectProject(project);
            resetProjectScopedData();
            setCreateProjectOpen(false);
            toast.success(t('project_created'));
            const conversation = await createConversation({
              project_id: project.id,
              title: t('new_conversation'),
            } as Parameters<typeof createConversation>[0]);
            if (conversation) router.push(getChatHref());
          } catch (error) {
            // Plan limits open the upgrade dialog; anything else shows the server's reason.
            if (handlePlanLimitError(error)) return;
            const detail = errorDetail(error);
            toast.error(detail ? `${t('failed_create_project')}: ${detail}` : t('failed_create_project'));
          }
        }}
      />

      {allowsCreateOrg ? (
        <CreateOrganizationDialog
          open={createOrgOpen}
          // Someone with no organization can't close it: there is nothing to work in without one.
          closable={organizations.length > 0}
          showJoinHint={organizations.length === 0}
          onOpenChange={setCreateOrgOpen}
          saving={createOrg.isPending}
          onCreate={async (values) => {
            try {
              const org = await createOrg.mutateAsync(values as Parameters<typeof createOrg.mutateAsync>[0]);
              if (!org) return;
              setCurrentOrganization(org);
              void queryClient.invalidateQueries({ queryKey: ['workspace-config'] });
              setCreateOrgOpen(false);
              toast.success(t('organization_created'));
            } catch (error) {
              toast.error(errorDetail(error) || t('failed_create_organization'));
            }
          }}
        />
      ) : null}
    </>
  );
}

type NameAndDescription = { name: string; description?: string };

function CreateProjectDialog({
  open,
  onOpenChange,
  organizationName,
  saving,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationName: string | null;
  saving: boolean;
  onCreate: (values: NameAndDescription & { category: string; is_public: boolean }) => Promise<void>;
}) {
  const t = useTranslations('header');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setError(null);
  }, [open]);

  const validate = (value: string): string | null => {
    if (!value) return t('project_name_required');
    if (!value.trim()) return t('project_name_blank');
    if (value.length > 60) return t('project_name_max');
    if (value.trim().toLowerCase() === 'my project') return t('project_name_reserved');
    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('create_new_project')}</DialogTitle>
        </DialogHeader>
        {!organizationName ? (
          <p className="text-sm text-muted-foreground">{t('create_org_first')}</p>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const problem = validate(name);
              setError(problem);
              if (problem) return;
              void onCreate({
                name: name.trim(),
                description: description.trim() || undefined,
                category: 'general',
                is_public: false,
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="create-project-name">{t('project_name')}</Label>
              <Input
                id="create-project-name"
                value={name}
                maxLength={60}
                autoFocus
                placeholder={t('project_name_placeholder')}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'create-project-name-error' : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(validate(event.target.value));
                }}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span id="create-project-name-error" className="text-destructive">
                  {error}
                </span>
                <span>{name.length}/60</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-project-description">{t('optional_description')}</Label>
              <Textarea
                id="create-project-description"
                rows={3}
                value={description}
                placeholder={t('describe_project')}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('organization_name')}: <span className="font-medium text-foreground">{organizationName}</span>
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {t('create_project_button')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateOrganizationDialog({
  open,
  closable,
  showJoinHint,
  onOpenChange,
  saving,
  onCreate,
}: {
  open: boolean;
  closable: boolean;
  showJoinHint: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onCreate: (values: NameAndDescription) => Promise<void>;
}) {
  const t = useTranslations('header');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => (closable || next) && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={closable}
        onEscapeKeyDown={(event) => !closable && event.preventDefault()}
        onPointerDownOutside={(event) => !closable && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('create_organization')}</DialogTitle>
          <DialogDescription>{t('welcome_org')}</DialogDescription>
        </DialogHeader>
        {showJoinHint ? (
          <p className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">{t('org_join_existing_hint')}</p>
        ) : null}
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) {
              setError(t('org_name_required'));
              return;
            }
            void onCreate({ name: name.trim(), description: description.trim() || undefined });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="create-org-name">{t('organization_name')}</Label>
            <Input
              id="create-org-name"
              value={name}
              autoFocus
              placeholder={t('org_name_placeholder')}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-org-description">{t('optional_description')}</Label>
            <Textarea
              id="create-org-description"
              rows={3}
              value={description}
              placeholder={t('optional_description')}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving} className="w-full">
            {t('create_organization_button')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
