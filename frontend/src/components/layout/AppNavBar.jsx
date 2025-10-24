import React from 'react';

const AppNavBar = ({ selectedNav, setSelectedNav, isCollapsed, setIsCollapsed }) => {
  const navItems = [
    { id: 'workflows', label: 'Workflows', icon: '📋' },
    { id: 'environments', label: 'Environments', icon: '🌍' },
  ];

  return (
    <nav className={`flex flex-col bg-white dark:bg-gray-800 border-r border-gray-300 dark:border-gray-700 transition-all duration-300 ${isCollapsed ? 'w-14' : 'w-14'}`}>
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
          <span className="text-lg mb-1">{item.icon}</span>
          {!isCollapsed && <span className="text-xs">{item.label}</span>}
        </button>
      ))}
      
      <div className="flex-1" />
      
      {/* Collapse/Expand Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="p-3 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-cyan-900 dark:hover:text-cyan-400"
        title={isCollapsed ? 'Expand' : 'Collapse'}
      >
        <span className="text-lg">{isCollapsed ? '▶' : '◀'}</span>
      </button>
    </nav>
  );
};

export default AppNavBar;
