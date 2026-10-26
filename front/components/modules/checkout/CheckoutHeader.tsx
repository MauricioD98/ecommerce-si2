"use client"
import React from 'react';
import { useTranslations } from "next-intl";
import styles from "./checkout.module.scss";

export default function CheckoutHeader() {
    const t = useTranslations("Checkout");

    return (
        <div className={styles.header}>
            <h1>{t("title")}</h1>
            <p>{t("subtitle")}</p>
        </div>
    );
}
