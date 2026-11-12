import AppRoutes from "./routes/AppRoutes.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
