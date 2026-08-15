import LoginForm from "./LoginForm.jsx";
import LoginHeader from "./LoginHeader.jsx";

function Login({ onLogin }) {
  return (
    <main className="login-page">
      <div className="login-ambient"></div>
      <section className="login-panel">
        <LoginHeader />
        <LoginForm onLogin={onLogin} />
      </section>
    </main>
  );
}

export default Login;
