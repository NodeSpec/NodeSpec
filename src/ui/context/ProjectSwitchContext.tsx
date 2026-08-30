import React, { createContext, useContext } from 'react';

export interface ProjectSwitchActions {
  switchToProject: (projectId: string) => Promise<void>;
  getCurrentProjectId: () => string | null;
  getCurrentBranchId: () => string | null;
}

const ProjectSwitchContext = createContext<ProjectSwitchActions | null>(null);

export function ProjectSwitchProvider({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions: ProjectSwitchActions;
}) {
  return (
    <ProjectSwitchContext.Provider value={actions}>
      {children}
    </ProjectSwitchContext.Provider>
  );
}

export function useProjectSwitch(): ProjectSwitchActions | null {
  return useContext(ProjectSwitchContext);
}
