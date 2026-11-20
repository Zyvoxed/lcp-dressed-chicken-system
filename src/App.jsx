import AppRoutes from "./routes/AppRoutes.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";

function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  );
}

export default App;
