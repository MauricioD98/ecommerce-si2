"use client"
import React from 'react';
import styles from "./checkout.module.scss";

export default function CheckoutHeader() {
    return (
        <div className={styles.header}>
            <h1>Finalizar Compra</h1>
            <p>Completa tu pedido</p>
        </div>
    );
}
