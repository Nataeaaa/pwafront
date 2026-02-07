import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import logo from "../assets/logo.png";

export default function Register() {
    const nav = useNavigate();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [show, setShow] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        // Validación de contraseñas
        if (password !== confirmPassword) {
            setError("Las contraseñas no coinciden");
            return;
        }
        if (password.length < 6) {
            setError("La contraseña debe tener al menos 6 caracteres");
            return;
        }
        setLoading(true);
        try {
            const { data } = await api.post("/auth/register", { 
                name, 
                email, 
                password 
            });
            localStorage.setItem("token", data.token);
            setAuth(data.token);
            nav("/dashboard");
        } catch (err: any) {
            setError(err.response?.data?.message || "Error al registrarse");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-wrap">
            <div className="card">
                <div className="brand">
                    <img src={logo} alt="Logo" className="logo-img" />
                    <h2>TO-DO PWA</h2>
                    <p className="muted">Crea tu cuenta para comenzar</p>
                </div>
                <form className="form" onSubmit={onSubmit}>
                    <label>Nombre</label>
                    <input
                        type="text"
                        placeholder="Tu nombre completo"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                    />

                    <label>Email</label>
                    <input
                        type="email"
                        placeholder="tucorreo@dominio.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                    />

                    <label>Contraseña</label>
                    <div className="pass">
                        <input
                            type={show ? "text" : "password"}
                            placeholder="Mínimo 6 caracteres"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                        <button
                            type="button"
                            className="ghost"
                            onClick={() => setShow((s) => !s)}
                            aria-label="Mostrar/Ocultar contraseña"
                        />
                    </div>

                    <label>Confirmar Contraseña</label>
                    <div className="pass">
                        <input
                            type={showConfirm ? "text" : "password"}
                            placeholder="Confirma tu contraseña"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                        <button
                            type="button"
                            className="ghost"
                            onClick={() => setShowConfirm((s) => !s)}
                            aria-label="Mostrar/Ocultar contraseña"
                        />
                    </div>

                    {error && <p className="alert">{error}</p>}

                    <button className="btn primary" disabled={loading}>
                        {loading ? "Cargando..." : "Crear Cuenta"}
                    </button>
                </form>
                <div className="footer-links">
                    <span className="muted">¿Ya tienes cuenta?</span>
                    <Link to="/login">Iniciar Sesión</Link>
                </div>
            </div>
        </div>
    );
}