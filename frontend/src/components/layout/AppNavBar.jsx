import React from 'react';

const AppNavBar = ({ selectedNav, setSelectedNav, isCollapsed, setIsCollapsed }) => {
  const navItems = [
    { 
      id: 'workflows', 
      label: 'Workflows', 
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
        </svg>
      )
    },
    { 
      id: 'collections', 
      label: 'Collections', 
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
          <path d="M3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" />
          <path d="M14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
        </svg>
      )
    },
  ];

  return (
    <nav className={`flex flex-col bg-white dark:bg-gray-800 border-r border-gray-300 dark:border-gray-700 transition-all duration-300 ${isCollapsed ? 'w-14' : 'w-16'}`}>
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => {
            setSelectedNav(item.id);
            if (isCollapsed) setIsCollapsed(false);
          }}
          className={`relative flex flex-col items-center px-2 py-4 text-center transition-colors ${
            selectedNav === item.id
              ? 'bg-gray-100 dark:bg-gray-700 text-cyan-900 dark:text-cyan-400 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-cyan-900 dark:before:bg-cyan-500'
              : 'text-cyan-900 dark:text-cyan-400 hover:bg-cyan-900 hover:text-white dark:hover:bg-cyan-800'
          }`}
          title={item.label}
        >
          <div className="mb-1">{item.icon}</div>
          {!isCollapsed && <span className="text-xs">{item.label}</span>}
        </button>
      ))}
      
      {isCollapsed && (
        <>
          <div className="flex-1" />
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-cyan-900 dark:hover:text-cyan-400 focus:outline-none"
            title="Expand sidebar"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        </>
      )}
    </nav>
  );
};

export default AppNavBar;
