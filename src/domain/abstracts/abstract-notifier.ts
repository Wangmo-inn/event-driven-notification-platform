import { CreateNotificationDto } from 'src/application/dtos/create-notification.dto';
import { ILoggerService } from 'src/infrastructure/logger/interfaces/logger.service.interface';
import { NotificationChannelEnum } from '../enums/notification-chanel.enum';
import { INotifier } from '../interfaces/notifier.interface';

/**
 * Abstract notifier class
 * @description This is the abstract class for the notifier
 * @returns Abstract notifier class
 */
export abstract class AbstractNotifier implements INotifier {
  // NOTE: no @Inject here. Nest merges parameter-injection metadata from a base class into subclasses by
  // index, which silently replaced the subclass's param 0 (the provider) with the logger. Concrete
  // notifiers declare @Inject(LOGGER_SERVICE) on their own constructors instead.
  constructor(protected readonly logger: ILoggerService) {}

  /**
   * Send the notification
   * @param notification - The notification to send
   * @returns void
   */
  abstract send(notification: CreateNotificationDto): Promise<void>;

  /**
   * Validate the channel of the notification
   * @param providedChannel - The provided channel
   * @param expectedChannel - The expected channel
   * @returns void
   */
  protected validateChannel(providedChannel: NotificationChannelEnum, expectedChannel: NotificationChannelEnum): void {
    if (providedChannel !== expectedChannel) {
      this.logger.error(
        `Invalid channel. Expected: ${expectedChannel}, Got: ${providedChannel}`,
        'AbstractNotifier.validateChannel',
      );
      throw new Error(`Invalid channel. Expected: ${expectedChannel}, Got: ${providedChannel}`);
    }
  }
}
