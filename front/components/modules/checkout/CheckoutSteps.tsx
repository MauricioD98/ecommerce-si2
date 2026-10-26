"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import styles from "./checkout.module.scss";


export default function CheckoutSteps({ currentStep }: { currentStep: number }) {

    const t = useTranslations("Checkout.steps");
    const steps = [{ number: 1, title: t("delivery") },
    { number: 2, title: t("payment") },
    { number: 3, title: t("completed") }]


    return (
        <div className={styles.steps}>
            {
                steps.map((step, index) => (
                    <div key={index} className={styles.stepWrapper}>
                        <div className={`${styles.step} ${currentStep >= step.number ? styles.stepActive : ""} ${currentStep > step.number ? styles.stepCompleted : ""}`}>
                            <div className={styles.stepNumber}>
                                {
                                    currentStep > step.number ? (
                                        <Check size={18} strokeWidth={3} />
                                    ) : (
                                        step.number
                                    )
                                }

                            </div>
                            <span className={styles.stepTitle}>{step.title}</span>
                        </div>

                        {index < steps.length - 1 && (
                            <div className={`${styles.stepLine} ${currentStep > step.number ? styles.stepLineDone : ""}`}>
                            </div>
                        )}
                    </div>
                ))
            }
        </div>
    );
}
