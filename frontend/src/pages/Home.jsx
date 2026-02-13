import React from 'react';
import MainLayout from '../components/layout/MainLayout';

/**
 * Home — root page wrapper.
 *
 * Currently always renders MainLayout (sidebar + workspace).
 * TODO (Phase 5+): show a `WithoutSidebar` variant when no workflows exist,
 * similar to FlowTest's empty workspace pattern.
 */
const Home = () => {
  return (
    <div className="relative flex flex-col h-screen font-sans text-text-primary dark:text-text-primary-dark bg-surface-raised dark:bg-surface-dark-raised">
      <MainLayout />
    </div>
  );
};

export default Home;
