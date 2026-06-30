import { useEffect } from 'react';
import { useJobsStore } from './store/jobs-store';
import { JobForm } from './components/JobForm';
import { JobList } from './components/JobList';
import { JobDetail } from './components/JobDetail';
import './App.css';

function App() {
  const connectSocket = useJobsStore((s) => s.connectSocket);
  const disconnectSocket = useJobsStore((s) => s.disconnectSocket);

  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, [connectSocket, disconnectSocket]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Проверка URL</h1>
      </header>
      <main className="app-main">
        <aside className="app-sidebar">
          <JobForm />
          <JobList />
        </aside>
        <section className="app-content">
          <JobDetail />
        </section>
      </main>
    </div>
  );
}

export default App;
