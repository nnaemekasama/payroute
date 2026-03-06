import { Routes, Route, Link, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import TransactionListPage from './pages/TransactionListPage';
import PaymentFormPage from './pages/PaymentFormPage';
import TransactionDetailPage from './pages/TransactionDetailPage';

function App() {
  const location = useLocation();

  return (
    <ErrorBoundary>
      <div className="app">
        <nav className="nav">
          <div className="nav-inner">
            <Link to="/" className="nav-logo">
              <span className="logo-icon">P</span>
              PayRoute
            </Link>
            <div className="nav-links">
              <Link
                to="/"
                className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
              >
                Transactions
              </Link>
              <Link
                to="/payments/new"
                className={`nav-link btn-primary ${location.pathname === '/payments/new' ? 'active' : ''}`}
              >
                New Payment
              </Link>
            </div>
          </div>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<TransactionListPage />} />
            <Route path="/payments/new" element={<PaymentFormPage />} />
            <Route path="/payments/:id" element={<TransactionDetailPage />} />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
