# Autograna

App de finanças pessoais (com modo motorista de app e o assistente Copiloto), página de vendas, login com Google ou e-mail, assinatura mensal no cartão ou no Pix pelo Mercado Pago e e-mails automáticos do teste grátis.

Para colocar no ar do zero, siga o **[GUIA.md](GUIA.md)**.

## Como funciona a configuração

Nenhum arquivo precisa ser editado. Tudo o que muda de uma conta para outra fica nas **variáveis do Netlify** (lista completa na etapa 5.3 do guia). A cada publicação, o `scripts/configurar.mjs` lê essas variáveis e prepara o site: a conexão com o Firebase, o login com Google pelo endereço do site, o preço, o contato de suporte e os seus dados nos Termos e na Privacidade.

Os segredos (`FIREBASE_SERVICE_ACCOUNT`, `MP_ACCESS_TOKEN`, `SMTP_PASS` e `MP_WEBHOOK_SECRET`) ficam **só no Netlify**. Nunca coloque nenhum deles num arquivo deste repositório.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `site/` | O que o visitante abre: página de vendas (`index.html`), entrar e criar conta (`entrar.html`), o app (`app.html`), o painel do dono (`admin.html`), Termos, Privacidade e a página de resposta dos e-mails (`obrigado.html`) |
| `netlify/functions/` | O servidor: assinatura e pagamentos (`billing`), avisos do Mercado Pago (`mp-webhook`), respostas dos e-mails (`feedback`) e o envio automático de hora em hora (`emails-agendados`) |
| `netlify/lib/` | Código compartilhado pelo servidor (Firebase, Mercado Pago, e-mails) |
| `scripts/configurar.mjs` | Prepara o site com as variáveis do Netlify a cada publicação |
| `netlify.toml` | Como o Netlify publica: endereços (/app, /entrar…), regras de segurança e a pasta do servidor |
| `firestore.rules` | Regras do banco de dados (cole no Firebase, etapa 2.4 do guia) |

## Atualizar

Envie o arquivo novo para a mesma pasta aqui no GitHub (**Add file → Upload files**). O Netlify publica sozinho em 1 ou 2 minutos.
