import { Navigate } from 'react-router-dom';

// Redirect legacy index to the new landing page
const Index = () => {
  return <Navigate to="/" replace />;
};

export default Index;
