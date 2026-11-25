import amqp, { type Channel, type ConsumeMessage } from 'amqplib';

export const EVENTS_EXCHANGE = 'teamisty.events';
export type EventEnvelope = { eventId: string; eventType: string; occurredAt: string; payload: Record<string, unknown> };

export async function connectEventBus(): Promise<{ channel: Channel; close: () => Promise<void> }> {
  const connection = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://localhost:5672');
  const channel = await connection.createChannel();
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  return { channel, close: () => connection.close() };
}

export async function publishEvent(channel: Channel, event: EventEnvelope): Promise<void> {
  channel.publish(EVENTS_EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), { persistent: true, contentType: 'application/json', messageId: event.eventId });
}

export async function consumeWithRetry(channel: Channel, queue: string, routingKeys: string[], handler: (event: EventEnvelope) => Promise<void>): Promise<void> {
  const deadExchange = `${EVENTS_EXCHANGE}.dead`;
  const deadQueue = `${queue}.dead`;
  await channel.assertExchange(deadExchange, 'topic', { durable: true });
  await channel.assertQueue(deadQueue, { durable: true });
  await channel.bindQueue(deadQueue, deadExchange, '#');
  await channel.assertQueue(queue, { durable: true });
  for (const key of routingKeys) await channel.bindQueue(queue, EVENTS_EXCHANGE, key);
  await channel.consume(queue, async (message: ConsumeMessage | null) => {
    if (!message) return;
    try {
      await handler(JSON.parse(message.content.toString()) as EventEnvelope);
      channel.ack(message);
    } catch (error) {
      const retries = Number(message.properties.headers?.['x-retry-count'] ?? 0);
      if (retries < 3) {
        channel.publish(EVENTS_EXCHANGE, message.fields.routingKey, message.content, { persistent: true, headers: { 'x-retry-count': retries + 1 } });
      } else {
        channel.publish(deadExchange, message.fields.routingKey, message.content, { persistent: true, headers: { 'x-dead-letter-reason': String(error) } });
      }
      channel.ack(message);
    }
  });
}
