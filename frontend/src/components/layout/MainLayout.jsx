import React, { useState } from 'react';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import AppNavBar from './AppNavBar';
import Sidebar from './Sidebar';
import Workspace from './Workspace';
import MainHeader from './MainHeader';
import MainFooter from './MainFooter';

const MainLayout = () => {
  const [isNavBarCollapsed, setIsNavBarCollapsed] = useState(false);
  const [selectedNav, setSelectedNav] = useState('workflows');

  return (
    <>
      <MainHeader />
      <div className="h-px bg-gray-300 dark:bg-gray-700" />
      
      <main className="flex-1 overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Allotment>
          {/* Left: AppNavBar + Sidebar */}
          <Allotment.Pane
            preferredSize={isNavBarCollapsed ? 60 : 450}
            minSize={isNavBarCollapsed ? 60 : 450}
            maxSize={isNavBarCollapsed ? 60 : 600}
            snap={isNavBarCollapsed}
          >
            <div className="flex h-full text-xs bg-white dark:bg-gray-800">
              <AppNavBar
                selectedNav={selectedNav}
                setSelectedNav={setSelectedNav}
                isCollapsed={isNavBarCollapsed}
                setIsCollapsed={setIsNavBarCollapsed}
              />
              {!isNavBarCollapsed && (
                <div className="flex-1 h-full border-l border-gray-300 dark:border-gray-700">
                  <Sidebar selectedNav={selectedNav} />
                </div>
              )}
            </div>
          </Allotment.Pane>

          {/* Right: Workspace */}
          <Allotment.Pane>
            <Workspace />
          </Allotment.Pane>
        </Allotment>
      </main>

      <div className="h-px bg-gray-300 dark:bg-gray-700" />
      <MainFooter />
    </>
  );
};

export default MainLayout;
