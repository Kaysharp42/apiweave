import React from 'react';
import { MdHome, MdSettings } from 'react-icons/md';
import { BsFillCollectionFill } from 'react-icons/bs';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import { Transition } from '@headlessui/react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import useNavigationStore from '../../stores/NavigationStore';
import { AppNavBarItems, AppNavBarStyles } from '../../constants/AppNavBar';

const AppNavBar = () => {
  const navigationSelectedValue = useNavigationStore((state) => state.selectedNavVal);
  const updateNavigationSelectedValue = useNavigationStore((state) => state.setNavState);
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const toggleNavBarCollapse = useNavigationStore((state) => state.toggleNavBarCollapse);

  const navItems = [
    { 
      id: AppNavBarItems.workflows.value, 
      label: AppNavBarItems.workflows.displayValue, 
      icon: MdHome 
    },
    { 
      id: AppNavBarItems.collections.value, 
      label: AppNavBarItems.collections.displayValue, 
      icon: BsFillCollectionFill 
    },
    { 
      id: AppNavBarItems.settings.value, 
      label: AppNavBarItems.settings.displayValue, 
      icon: MdSettings 
    },
  ];

  const handleNavClick = (navId) => {
    updateNavigationSelectedValue(navId);
  };

  const selectedNavItemStyles = 'before:bg-cyan-600 dark:before:bg-cyan-400 bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400';
  const nonSelectedNavItemStyles = 'hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200';
  const navStyles = 'relative flex h-full flex-col transition-all duration-300 ease-in-out bg-white dark:bg-gray-800 border-r border-gray-300 dark:border-gray-700';

  return (
    <nav
      className={`${navStyles} ${
        isNavBarCollapsed 
          ? 'w-8 min-w-8'
          : 'w-25 min-w-25'
      }`}
      style={{
        width: isNavBarCollapsed 
          ? AppNavBarStyles.collapsedNavBarWidth.absolute + 'px'
          : AppNavBarStyles.expandedNavBarWidth.absolute + 'px'
      }}
    >
      {/* Navigation Items */}
      <div className="flex-1">
        {navItems.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            className={`relative w-full ${index < navItems.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''}`}
            onClick={() => handleNavClick(id)}
          >
            <div
              className={`${
                navigationSelectedValue === id
                  ? `before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:content-[""] ${selectedNavItemStyles}`
                  : nonSelectedNavItemStyles
              } flex w-full flex-col items-center px-3 py-4 text-center transition-all duration-200 text-gray-600 dark:text-gray-400`}
            >
              {isNavBarCollapsed ? (
                <Tippy content={label} placement="right">
                  <Icon className="w-5 h-5" />
                </Tippy>
              ) : (
                <>
                  <Icon className="w-5 h-5 mb-2" />
                  <Transition
                    show={!isNavBarCollapsed}
                    enter="transition-all ease-in-out duration-500 delay-[200ms]"
                    enterFrom="opacity-0 translate-y-2"
                    enterTo="opacity-100 translate-y-0"
                    leave="transition-all ease-in-out duration-300"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <span className="text-xs font-medium">{label}</span>
                  </Transition>
                </>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Collapse Toggle Button */}
      <button
        onClick={toggleNavBarCollapse}
        className="flex items-center justify-center p-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors duration-200 border-t border-gray-200 dark:border-gray-700"
      >
        {isNavBarCollapsed ? (
          <Tippy content="Expand Navigation" placement="right">
            <MdChevronRight className="w-4 h-4" />
          </Tippy>
        ) : (
          <MdChevronLeft className="w-4 h-4" />
        )}
      </button>
    </nav>
  );
};

export default AppNavBar;
