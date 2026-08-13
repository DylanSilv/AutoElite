import { createHmac } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';
import { setLlmProvider } from '../src/modules/agent/llm.factory.js';
import { createCatalog, createCommerce, resetDatabase } from './helpers/factories.js';
import { api } from './helpers/request.js';

/**
 * Webhook de WhatsApp.
 *
 * Es el único punto del sistema abierto a internet sin credenciales nuestras,
 * así que lo que importa acá es que nadie más que Meta pueda meter un pedido en
 * la cocina.
 */

const PATH = '/webhooks/whatsapp';
const PHONE_NUMBER_ID = '123456789012345';
const APP_SECRET = 'secreto-de-prueba-de-la-app';

let commerceId: number;

function payload(text: string, messageId = 'wamid.uno') {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Martina' }, wa_id: '59899123456' }],
              messages: [
                { from: '59899123456', id: messageId, type: 'text', text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function sign(body: unknown): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(JSON.stringify(body)).digest('hex')}`;
}

/**
 * El webhook contesta 200 antes de procesar, así que hay que esperar a que el
 * trabajo de fondo termine para poder mirar la base.
 */
async function esperarProcesado(): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if ((await prisma.conversationMessage.count()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeEach(async () => {
  await resetDatabase();
  setLlmProvider(null);

  const commerce = await createCommerce('La Napolitana');
  commerceId = commerce.id;
  await createCatalog(commerce.id);
  await prisma.commerce.update({
    where: { id: commerce.id },
    data: { whatsappPhoneNumberId: PHONE_NUMBER_ID },
  });

  env.WHATSAPP_VERIFY_TOKEN = 'token-de-alta';
  env.WHATSAPP_APP_SECRET = APP_SECRET;
});

afterAll(async () => {
  env.WHATSAPP_VERIFY_TOKEN = undefined;
  env.WHATSAPP_APP_SECRET = undefined;
  await resetDatabase();
  await prisma.$disconnect();
});

describe('alta del webhook', () => {
  it('devuelve el desafío cuando el token coincide', async () => {
    const res = await api
      .get(PATH)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-de-alta', 'hub.challenge': '9876' })
      .expect(200);

    expect(res.text).toBe('9876');
  });

  it('rechaza un token que no es el nuestro', async () => {
    await api
      .get(PATH)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '9876' })
      .expect(403);
  });
});

describe('autenticidad de las entregas', () => {
  it('rechaza una entrega sin firma', async () => {
    // Sin esto, cualquiera que conozca la URL manda pedidos falsos a la cocina.
    await api.post(PATH).send(payload('hola')).expect(401);
    expect(await prisma.conversationMessage.count()).toBe(0);
  });

  it('rechaza una firma que no corresponde al cuerpo', async () => {
    const body = payload('hola');
    const otra = createHmac('sha256', APP_SECRET).update('{}').digest('hex');

    await api.post(PATH).set('x-hub-signature-256', `sha256=${otra}`).send(body).expect(401);
    expect(await prisma.conversationMessage.count()).toBe(0);
  });

  it('acepta una entrega firmada y responde al cliente', async () => {
    const body = payload('hola, me pasás la carta?');

    await api.post(PATH).set('x-hub-signature-256', sign(body)).send(body).expect(200);
    await esperarProcesado();

    const conversation = await prisma.conversation.findFirst({
      include: { messages: { orderBy: { id: 'asc' } } },
    });
    expect(conversation?.phoneE164).toBe('+59899123456');
    expect(conversation?.contactName).toBe('Martina');

    const respuesta = conversation?.messages.find((m) => m.role === 'ASSISTANT');
    expect(respuesta?.body).toContain('Muzzarella');

    // La respuesta queda encolada para enviarse por WhatsApp.
    const salida = await prisma.outboundMessage.findMany({ where: { kind: 'AGENT_REPLY' } });
    expect(salida).toHaveLength(1);
  });
});

describe('robustez', () => {
  it('ignora un mensaje de un número que no es de ningún comercio', async () => {
    await prisma.commerce.update({
      where: { id: commerceId },
      data: { whatsappPhoneNumberId: 'otro-numero' },
    });

    const body = payload('hola');
    await api.post(PATH).set('x-hub-signature-256', sign(body)).send(body).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await prisma.conversationMessage.count()).toBe(0);
  });

  it('no procesa dos veces el mismo mensaje', async () => {
    // WhatsApp reintenta cuando no recibe el 200 a tiempo.
    const body = payload('una muzzarella grande', 'wamid.repetido');

    await api.post(PATH).set('x-hub-signature-256', sign(body)).send(body).expect(200);
    await esperarProcesado();
    await api.post(PATH).set('x-hub-signature-256', sign(body)).send(body).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const entrantes = await prisma.conversationMessage.count({ where: { role: 'CUSTOMER' } });
    expect(entrantes).toBe(1);
  });

  it('marca como fallido el aviso que WhatsApp no pudo entregar', async () => {
    const message = await prisma.outboundMessage.create({
      data: {
        commerceId,
        toPhoneE164: '+59899123456',
        kind: 'ORDER_READY_PICKUP',
        body: 'Tu pedido está listo',
        status: 'SENT',
        providerMessageId: 'wamid.enviado',
      },
    });

    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [
                  { id: 'wamid.enviado', status: 'failed', errors: [{ title: 'Número inválido' }] },
                ],
              },
            },
          ],
        },
      ],
    };

    await api.post(PATH).set('x-hub-signature-256', sign(body)).send(body).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const actualizado = await prisma.outboundMessage.findUnique({ where: { id: message.id } });
    expect(actualizado?.status).toBe('FAILED');
    expect(actualizado?.lastError).toContain('Número inválido');
  });
});
