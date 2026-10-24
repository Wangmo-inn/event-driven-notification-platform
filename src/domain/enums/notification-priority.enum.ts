/**
 * BullMQ priority: a LOWER number is processed FIRST. OTP codes are useless if late, so they
 * jump ahead of bulk traffic.
 */
export enum NotificationPriorityEnum {
  CRITICAL = 1, // OTP / verification codes
  HIGH = 2, // security alerts, event-driven notifications
  NORMAL = 3, // welcome emails, confirmations
  LOW = 4, // digests / marketing
}

export const JOB_TYPE_PRIORITY: Record<'notification' | 'welcome-email' | 'verification-code', NotificationPriorityEnum> =
  {
    'verification-code': NotificationPriorityEnum.CRITICAL,
    notification: NotificationPriorityEnum.HIGH,
    'welcome-email': NotificationPriorityEnum.NORMAL,
  };
